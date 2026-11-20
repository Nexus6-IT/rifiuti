/**
 * Serializzatore PURO JSON -> XML del registro RENTRI (E4). Nessuna I/O, nessuna dipendenza di
 * dominio: parte dal corpo prodotto da `traduciAnnotazione` (la stessa traduzione che alimenta la
 * trasmissione) e produce l'XML `mov:` nell'ordine degli elementi dell'XSD (`rentri-movimenti-1.0`,
 * `rentri-registri-1.0`). L'XML e' compatto (nessuno spazio fra gli elementi) perche' verra' firmato.
 *
 * FAIL-CLOSED: una proprieta' del corpo che non conosciamo, un tipo sbagliato o un carattere che
 * XML 1.0 non ammette NON vengono scartati o corretti in silenzio: errore, e l'esportazione non nasce.
 * I messaggi di errore non riportano mai il contenuto dei dati (solo il nome del campo).
 */

/** Il corpo o gli argomenti non sono serializzabili. Il messaggio non contiene dati dell'operatore. */
export class XmlRegistroNonSerializzabileError extends Error {
  constructor(motivo: string) {
    super(`XML del registro non serializzabile: ${motivo}`)
    this.name = 'XmlRegistroNonSerializzabileError'
  }
}

export const NS_REGISTRI = 'urn:it:rentri:registri:1.0'
export const NS_MOVIMENTI = 'urn:it:rentri:movimenti:1.0'
export const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance'

const DICHIARAZIONE_XML = '<?xml version="1.0" encoding="UTF-8"?>'
const PATTERN_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const PATTERN_DECIMALE = /^\d+(\.\d+)?$/
/** Tutto cio' che XML 1.0 non ammette (compresi i surrogati spaiati, grazie al flag `u`). */
// eslint-disable-next-line no-control-regex -- intercettare i controlli C0 e' lo scopo
const CARATTERI_NON_XML = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u

type Oggetto = Record<string, unknown>

export interface VoceRegistro {
  /** `corpo` di `EsitoTraduzione`: movimento (con `riferimenti`) o annullamento. */
  corpo: Record<string, unknown>
  autore: string
  /** `xs:dateTime` (ISO 8601). */
  identificativoTemporale: string
}

export interface RiferimentoPrecedente {
  /** Base64, cosi' com'e' nel `DigestValue` dell'esportazione precedente (o dell'eREGI). */
  digestValue: string
  dataCreazione: string
}

export interface GruppoRegistrazioni {
  anno: number
  progressivoDa: number
  progressivoA: number
  dataCreazione: string
  /** Una voce per progressivo, in ordine: `voci.length === progressivoA - progressivoDa + 1`. */
  voci: VoceRegistro[]
}

export interface InputSerializzaRegistro {
  /** XML dell'eREGI cosi' come lo ha rilasciato RENTRI: si inserisce VERBATIM (e' firmato dall'ente). */
  eregXml: string
  /** eREGI per primo, poi tutte le esportazioni precedenti in ordine. Vuoto solo se non c'e' catena. */
  riferimenti: RiferimentoPrecedente[]
  /** Di norma uno; piu' di uno se l'intervallo attraversa un cambio d'anno. */
  registrazioni: GruppoRegistrazioni[]
}

function errore(motivo: string): never {
  throw new XmlRegistroNonSerializzabileError(motivo)
}

/** Escape del testo e degli attributi (`&`, `<`, `>`, virgolette, `\r` che l'XML normalizzerebbe). */
export function escapeXml(valore: string, campo: string, attributo = false): string {
  if (CARATTERI_NON_XML.test(valore))
    errore(`il campo ${campo} contiene caratteri non ammessi da XML`)
  return (
    valore
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/\r/g, '&#13;')
      // Nel valore di un attributo il parser normalizza tab e a capo in spazi: vanno protetti.
      .replace(/\t/g, attributo ? '&#9;' : '\t')
      .replace(/\n/g, attributo ? '&#10;' : '\n')
  )
}

function el(nome: string, contenuto: string): string {
  return `<${nome}>${contenuto}</${nome}>`
}

function testo(nome: string, valore: unknown, campo: string): string {
  if (typeof valore !== 'string' || valore === '')
    errore(`il campo ${campo} deve essere un testo non vuoto`)
  return el(nome, escapeXml(valore, campo))
}

function dataOra(nome: string, valore: unknown, campo: string): string {
  if (typeof valore !== 'string' || !PATTERN_DATA.test(valore)) {
    errore(`il campo ${campo} deve essere una data ISO 8601`)
  }
  return el(nome, valore)
}

function intero(valore: unknown, campo: string): string {
  if (typeof valore !== 'number' || !Number.isSafeInteger(valore)) {
    errore(`il campo ${campo} deve essere un intero`)
  }
  return String(valore)
}

/** Decimale in notazione posizionale (mai `1e-7`): `xs:decimal` non ammette l'esponente. */
function decimale(nome: string, valore: unknown, campo: string): string {
  if (
    typeof valore !== 'number' ||
    !Number.isFinite(valore) ||
    valore < 0 ||
    Object.is(valore, -0)
  ) {
    errore(`il campo ${campo} deve essere un numero non negativo`)
  }
  let s = String(valore)
  if (/e/i.test(s)) s = valore.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  // Se la forma posizionale non rappresenta lo stesso numero, si e' perso qualcosa (es. 1e-11 -> 0).
  if (!PATTERN_DECIMALE.test(s) || Number(s) !== valore) {
    errore(`il campo ${campo} non e' rappresentabile come decimale senza perdita`)
  }
  return el(nome, s)
}

function oggetto(valore: unknown, campo: string, ammesse: readonly string[]): Oggetto {
  if (typeof valore !== 'object' || valore === null || Array.isArray(valore)) {
    errore(`il campo ${campo} deve essere un oggetto`)
  }
  const o = valore as Oggetto
  for (const k of Object.keys(o)) {
    if (!ammesse.includes(k)) errore(`proprieta' non gestita in ${campo}: ${k}`)
  }
  return o
}

function lista(valore: unknown, campo: string): unknown[] {
  if (!Array.isArray(valore)) errore(`il campo ${campo} deve essere un elenco`)
  return valore
}

/** Concatena i figli nell'ordine dell'XSD, saltando quelli assenti. */
function opz<T>(valore: T | undefined, f: (v: T) => string): string {
  return valore === undefined ? '' : f(valore)
}

function identificativoMovimento(nome: string, v: unknown, campo: string): string {
  const o = oggetto(v, campo, ['anno', 'progressivo'])
  return el(
    nome,
    el('mov:Anno', intero(o.anno, `${campo}.anno`)) +
      el('mov:Progressivo', intero(o.progressivo, `${campo}.progressivo`))
  )
}

function riferimenti(v: unknown): string {
  const o = oggetto(v, 'riferimenti', [
    'numero_registrazione',
    'data_ora_registrazione',
    'numero_registrazione_rettifica',
    'causale_operazione',
    'riferimento_operazione',
  ])
  return el(
    'mov:Riferimenti',
    identificativoMovimento(
      'mov:NumeroRegistrazione',
      o.numero_registrazione,
      'numero_registrazione'
    ) +
      dataOra('mov:DataOraRegistrazione', o.data_ora_registrazione, 'data_ora_registrazione') +
      opz(o.numero_registrazione_rettifica, x =>
        identificativoMovimento(
          'mov:NumeroRegistrazioneRettifica',
          x,
          'numero_registrazione_rettifica'
        )
      ) +
      opz(o.causale_operazione, x => testo('mov:CausaleOperazione', x, 'causale_operazione')) +
      opz(o.riferimento_operazione, x =>
        el(
          'mov:RiferimentoOperazione',
          lista(x, 'riferimento_operazione')
            .map(r =>
              identificativoMovimento('mov:IdentificativoMovimento', r, 'riferimento_operazione')
            )
            .join('')
        )
      )
  )
}

function rifiuto(v: unknown): string {
  const o = oggetto(v, 'rifiuto', [
    'codice_eer',
    'descrizione_eer',
    'provenienza',
    'caratteristiche_pericolo',
    'stato_fisico',
    'quantita',
    'destinato_attivita',
  ])
  const q = oggetto(o.quantita, 'quantita', ['valore', 'unita_misura'])
  return el(
    'mov:Rifiuto',
    testo('mov:CodiceEer', o.codice_eer, 'codice_eer') +
      opz(o.descrizione_eer, x => testo('mov:DescrizioneEer', x, 'descrizione_eer')) +
      opz(o.provenienza, x => testo('mov:Provenienza', x, 'provenienza')) +
      opz(o.caratteristiche_pericolo, x =>
        el(
          'mov:CaratteristichePericolo',
          lista(x, 'caratteristiche_pericolo')
            .map(h => testo('mov:CaratteristicaPericolo', h, 'caratteristiche_pericolo'))
            .join('')
        )
      ) +
      testo('mov:StatoFisico', o.stato_fisico, 'stato_fisico') +
      el(
        'mov:Quantita',
        decimale('mov:Valore', q.valore, 'quantita.valore') +
          testo('mov:UnitaMisura', q.unita_misura, 'quantita.unita_misura')
      ) +
      opz(o.destinato_attivita, x => testo('mov:DestinatoAttivita', x, 'destinato_attivita'))
  )
}

function integrazioneFir(v: unknown): string {
  const o = oggetto(v, 'integrazione_fir', ['numero_fir', 'data_inizio_trasporto'])
  return el(
    'mov:IntegrazioneFir',
    opz(o.numero_fir, x => testo('mov:NumeroFir', x, 'numero_fir')) +
      opz(o.data_inizio_trasporto, x =>
        dataOra('mov:DataInizioTrasporto', x, 'data_inizio_trasporto')
      )
  )
}

function esito(v: unknown): string {
  const o = oggetto(v, 'esito', ['data_fine_trasporto', 'peso_verificato_destino'])
  return el(
    'mov:Esito',
    opz(o.data_fine_trasporto, x => dataOra('mov:DataFineTrasporto', x, 'data_fine_trasporto')) +
      opz(o.peso_verificato_destino, x =>
        decimale('mov:PesoVerificatoDestino', x, 'peso_verificato_destino')
      )
  )
}

function indirizzo(v: unknown): string {
  const o = oggetto(v, 'indirizzo', ['citta', 'indirizzo', 'civico', 'cap'])
  const c = oggetto(o.citta, 'citta', ['comune_id'])
  if (typeof c.comune_id !== 'string' || c.comune_id === '')
    errore("il campo comune_id e' obbligatorio")
  // `Indirizzo` e' di tipo astratto IndirizzoBase: l'istanza deve dichiarare il tipo concreto.
  return (
    '<mov:Indirizzo xsi:type="mov:IndirizzoItaliano">' +
    testo('mov:Indirizzo', o.indirizzo, 'indirizzo.indirizzo') +
    opz(o.civico, x => testo('mov:Civico', x, 'indirizzo.civico')) +
    opz(o.cap, x => testo('mov:Cap', x, 'indirizzo.cap')) +
    `<mov:Citta ComuneId="${escapeXml(c.comune_id, 'comune_id', true)}"/>` +
    '</mov:Indirizzo>'
  )
}

function produttore(v: unknown): string {
  const o = oggetto(v, 'produttore', ['denominazione', 'codice_fiscale', 'indirizzo'])
  return el(
    'mov:Produttore',
    opz(o.denominazione, x => testo('mov:Denominazione', x, 'denominazione')) +
      opz(o.codice_fiscale, x => testo('mov:CodiceFiscale', x, 'codice_fiscale')) +
      indirizzo(o.indirizzo)
  )
}

function trasportatore(v: unknown): string {
  const o = oggetto(v, 'trasportatore', ['denominazione', 'codice_fiscale', 'num_iscrizione_albo'])
  return el(
    'mov:Trasportatore',
    testo('mov:Denominazione', o.denominazione, 'denominazione') +
      testo('mov:CodiceFiscale', o.codice_fiscale, 'codice_fiscale') +
      opz(o.num_iscrizione_albo, x => testo('mov:NumIscrizioneAlbo', x, 'num_iscrizione_albo'))
  )
}

function destinatario(v: unknown): string {
  const o = oggetto(v, 'destinatario', ['denominazione', 'codice_fiscale', 'num_autorizzazione'])
  return el(
    'mov:Destinatario',
    testo('mov:Denominazione', o.denominazione, 'denominazione') +
      testo('mov:CodiceFiscale', o.codice_fiscale, 'codice_fiscale') +
      opz(o.num_autorizzazione, x => testo('mov:NumAutorizzazione', x, 'num_autorizzazione'))
  )
}

function intestazione(autore: string, identificativoTemporale: string): string {
  return (
    testo('mov:Autore', autore, 'autore') +
    dataOra('mov:IdentificativoTemporale', identificativoTemporale, 'identificativoTemporale')
  )
}

/**
 * Serializza UNA registrazione: `<reg:Movimento>` oppure `<reg:AnnullamentoMovimento>` (secondo la
 * forma del corpo). Il frammento usa i prefissi `reg`, `mov` e `xsi`, che devono essere dichiarati
 * dall'elemento che lo contiene (lo fa `reg:Registrazioni` in {@link serializzaRegistro}).
 */
export function serializzaMovimento(
  corpo: Record<string, unknown>,
  autore: string,
  identificativoTemporale: string
): string {
  if ('riferimenti' in corpo) {
    const o = oggetto(corpo, 'corpo', [
      'riferimenti',
      'rifiuto',
      'integrazione_fir',
      'esito',
      'produttore',
      'trasportatore',
      'destinatario',
      'annotazioni',
    ])
    return el(
      'reg:Movimento',
      intestazione(autore, identificativoTemporale) +
        riferimenti(o.riferimenti) +
        opz(o.rifiuto, rifiuto) +
        opz(o.integrazione_fir, integrazioneFir) +
        opz(o.esito, esito) +
        opz(o.produttore, produttore) +
        opz(o.trasportatore, trasportatore) +
        opz(o.destinatario, destinatario) +
        opz(o.annotazioni, x => testo('mov:Annotazioni', x, 'annotazioni'))
    )
  }
  const o = oggetto(corpo, 'corpo', [
    'numero_registrazione',
    'data_ora_registrazione',
    'numero_registrazione_annullata',
    'annotazioni',
  ])
  return el(
    'reg:AnnullamentoMovimento',
    intestazione(autore, identificativoTemporale) +
      identificativoMovimento(
        'mov:NumeroRegistrazione',
        o.numero_registrazione,
        'numero_registrazione'
      ) +
      dataOra('mov:DataOraRegistrazione', o.data_ora_registrazione, 'data_ora_registrazione') +
      identificativoMovimento(
        'mov:NumeroRegistrazioneAnnullata',
        o.numero_registrazione_annullata,
        'numero_registrazione_annullata'
      ) +
      opz(o.annotazioni, x => testo('mov:Annotazioni', x, 'annotazioni'))
  )
}

/**
 * Toglie dichiarazione XML e spazi esterni all'eREGI e lo restituisce IDENTICO, byte per byte, per
 * il resto. Non lo parsa ne' lo ri-serializza: e' firmato da RENTRI e ogni byte conta.
 */
function eregiVerbatim(xml: string): string {
  if (typeof xml !== 'string') errore("l'eREGI deve essere un testo")
  if (/<!DOCTYPE/i.test(xml)) errore("l'eREGI non puo' contenere un DOCTYPE")
  const s = (xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml)
    .replace(/^\s*<\?xml[^>]*\?>/, '')
    .trim()
  if (!/^<(?:[A-Za-z_][\w.-]*:)?eREGI[\s/>]/.test(s) || !s.endsWith('>')) {
    errore("l'eREGI non ha la forma attesa")
  }
  if (s.includes('<?xml')) errore("l'eREGI contiene una seconda dichiarazione XML")
  return s
}

/** Numero di registrazione della voce: `riferimenti.numero_registrazione` (movimento) o `numero_registrazione` (annullamento). */
function numeroVoce(corpo: Record<string, unknown>): { anno: unknown; progressivo: unknown } {
  const sorgente = 'riferimenti' in corpo ? (corpo.riferimenti as Oggetto | null) : corpo
  const n =
    sorgente && typeof sorgente === 'object' ? (sorgente as Oggetto).numero_registrazione : null
  if (typeof n !== 'object' || n === null) errore('una voce non ha il numero di registrazione')
  return { anno: (n as Oggetto).anno, progressivo: (n as Oggetto).progressivo }
}

function gruppo(g: GruppoRegistrazioni): string {
  const attesi = g.progressivoA - g.progressivoDa + 1
  if (g.progressivoA < g.progressivoDa || g.voci.length !== attesi) {
    errore("il numero di voci non coincide con l'intervallo di progressivi")
  }
  g.voci.forEach((v, i) => {
    const n = numeroVoce(v.corpo)
    if (n.anno !== g.anno || n.progressivo !== g.progressivoDa + i) {
      errore("i numeri delle voci non coincidono con l'intervallo del gruppo")
    }
  })
  const attributi =
    ` Anno="${intero(g.anno, 'anno')}"` +
    ` ProgressivoDa="${intero(g.progressivoDa, 'progressivoDa')}"` +
    ` ProgressivoA="${intero(g.progressivoA, 'progressivoA')}"` +
    ` NumeroRegistrazioni="${attesi}"` +
    ` DataCreazione="${dataAttributo(g.dataCreazione, 'dataCreazione')}"`
  // `mov` e `xsi` sono dichiarati qui e non sulla radice: cosi' l'eREGI incorporato eredita solo
  // `reg` e la sua firma resta valida anche se l'ente l'ha calcolata con C14N inclusiva (M5, E5).
  return `<reg:Registrazioni xmlns:mov="${NS_MOVIMENTI}" xmlns:xsi="${NS_XSI}"${attributi}>${g.voci
    .map(v => serializzaMovimento(v.corpo, v.autore, v.identificativoTemporale))
    .join('')}</reg:Registrazioni>`
}

function dataAttributo(valore: unknown, campo: string): string {
  if (typeof valore !== 'string' || !PATTERN_DATA.test(valore)) {
    errore(`il campo ${campo} deve essere una data ISO 8601`)
  }
  return valore
}

function riferimento(r: RiferimentoPrecedente): string {
  if (typeof r.digestValue !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.digestValue)) {
    errore("digestValue non e' base64")
  }
  return `<reg:Ref DigestValue="${r.digestValue}" DataCreazione="${dataAttributo(r.dataCreazione, 'dataCreazione')}"/>`
}

/**
 * Serializza il `reg:Registro` (non firmato): eREGI verbatim, `RiferimentiPrecedenti` (omesso se
 * vuoto), una o piu' `Registrazioni`. Funzione pura: la firma e' di E5, la validazione XSD di
 * `validaXmlRegistro`.
 */
export function serializzaRegistro(input: InputSerializzaRegistro): string {
  if (input.registrazioni.length === 0) errore('nessuna registrazione')
  // Gruppi in ordine e senza sovrapposizioni: anno crescente, o stesso anno con progressivi successivi.
  input.registrazioni.forEach((g, i) => {
    const p = input.registrazioni[i - 1]
    if (p && (g.anno < p.anno || (g.anno === p.anno && g.progressivoDa <= p.progressivoA))) {
      errore('i gruppi di registrazioni non sono in ordine o si sovrappongono')
    }
  })
  return (
    DICHIARAZIONE_XML +
    `<reg:Registro xmlns:reg="${NS_REGISTRI}">` +
    eregiVerbatim(input.eregXml) +
    (input.riferimenti.length > 0
      ? el('reg:RiferimentiPrecedenti', input.riferimenti.map(riferimento).join(''))
      : '') +
    input.registrazioni.map(gruppo).join('') +
    '</reg:Registro>'
  )
}
