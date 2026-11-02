import { Prisma } from '@prisma/client'
import { cerCanonico } from '../waste-movement/cer-registro'
import { TipoProvvigione } from './addebito'
import { cascataValida, importoRiga, normalizzaCascata } from './importi-riga'
import {
  ApplicaPrezzoSpeciale,
  Scaglione,
  TipoCalcoloScaglione,
  validaPrezzoSpeciale,
  validaScaglioni,
} from './prezzo-speciale'
import { PeriodoScadenze, Scadenza, validaScadenze } from './scadenze-fisse'
import { FamigliaAddebito, famigliaTipo, tipoAddebitoValido } from './tipi-addebito'

/**
 * Riga di addebito di un elenco (4.2b, D9-D12, D14, D17, E11, E15-E16): regole pure, senza
 * database. Il servizio chiama `normalizzaRiga` sul corpo (o sul corpo unito alla riga di prima,
 * per il PATCH) e poi `validaRiga` sui dati; i controlli che richiedono il database (CER nel
 * catalogo, riferimenti fra righe, D11) restano nel servizio.
 *
 * Ogni regola che il database impone con un CHECK e' riprodotta qui, cosi' l'utente riceve un 400
 * con il messaggio e mai un 500 (Task 19, "Allineamento Task 17"). Nessun messaggio riporta il
 * valore ricevuto. Importi e percentuali sono stringhe decimali.
 */

export type CampoRiga =
  | 'tipo'
  | 'cerCode'
  | 'addebitoId'
  | 'riferimento'
  | 'descrizione'
  | 'tipoQuantita'
  | 'quantitaFissa'
  | 'unitaMisura'
  | 'prezzo'
  | 'prezzoSpeciale'
  | 'sconto'
  | 'codiceIvaId'
  | 'provvigione'
  | 'tipoProvvigione'
  | 'tipologiaRifiuto'
  | 'statoFisico'
  | 'operazione'
  | 'categoriaId'
  | 'centroRicavoId'
  | 'applicaA'
  | 'condizione'
  | 'condizioniRiferite'
  | 'minimoFatturabile'
  | 'minimoPerCategoria'
  | 'riferimentoGiorno'
  | 'riferimentoMese'
  | 'periodoScadenze'
  | 'periodoExtraDal'
  | 'periodoExtraAl'
  | 'stimaAnnuaKg'
  | 'cerProposta'
  | 'addebitiProposti'
  | 'appunti'
  | 'notaUsoInterno'
  | 'scaglioni'
  | 'scadenze'

export type TipoQuantita = 'PESO_NETTO' | 'PESO_LORDO' | 'VOLUME' | 'UNO' | 'ALTRO'
export type TipologiaRifiuto = 'URBANO' | 'URBANO_PERICOLOSO' | 'SPECIALE' | 'SPECIALE_PERICOLOSO'

export interface DatiRiga {
  tipo: string
  /** Solo `CER`, nella forma del catalogo ("20 03 01", "20 01 21*"). */
  cerCode: string | null
  /** Solo i tipi diversi da `CER`. */
  addebitoId: string | null
  /** `null` = riferimento vuoto; `?` = qualsiasi riferimento non indicato. */
  riferimento: string | null
  descrizione: string | null
  tipoQuantita: TipoQuantita | null
  /** Solo `F`; `null` = 1, `0` = non fatturare. */
  quantitaFissa: string | null
  unitaMisura: string
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIvaId: string | null
  provvigione: string | null
  tipoProvvigione: TipoProvvigione | null
  tipologiaRifiuto: TipologiaRifiuto | null
  statoFisico: string | null
  operazione: string | null
  categoriaId: string | null
  centroRicavoId: string | null
  applicaA: ApplicaPrezzoSpeciale | null
  condizione: number | null
  condizioniRiferite: string | null
  minimoFatturabile: string | null
  minimoPerCategoria: boolean
  riferimentoGiorno: number | null
  riferimentoMese: number | null
  periodoScadenze: PeriodoScadenze | null
  /** Date `YYYY-MM-DD`. */
  periodoExtraDal: string | null
  periodoExtraAl: string | null
  stimaAnnuaKg: string | null
  cerProposta: string[]
  addebitiProposti: string[]
  appunti: string | null
  notaUsoInterno: string | null
  scaglioni: Scaglione[]
  scadenze: Scadenza[]
}

/** R36: `campo` null = regola fra piu' campi. */
export interface ErroreRiga {
  campo: CampoRiga | null
  messaggio: string
}

export const ETICHETTE_CAMPI_RIGA: Readonly<Record<CampoRiga, string>> = {
  tipo: 'Tipo',
  cerCode: 'Codice CER',
  addebitoId: 'Addebito',
  riferimento: 'Riferimento',
  descrizione: 'Descrizione',
  tipoQuantita: 'Quantità',
  quantitaFissa: 'Quantità fissa',
  unitaMisura: 'Unità di misura',
  prezzo: 'Prezzo',
  prezzoSpeciale: 'Prezzo speciale',
  sconto: 'Sconto',
  codiceIvaId: 'Codice IVA',
  provvigione: 'Provvigione',
  tipoProvvigione: 'Tipo provvigione',
  tipologiaRifiuto: 'Tipologia del rifiuto',
  statoFisico: 'Stato fisico',
  operazione: 'Operazione',
  categoriaId: 'Categoria',
  centroRicavoId: 'Centro di ricavo',
  applicaA: 'Il prezzo speciale si applica a',
  condizione: 'Condizione',
  condizioniRiferite: 'Condizioni riferite',
  minimoFatturabile: 'Minimo fatturabile',
  minimoPerCategoria: 'Minimo per categoria',
  riferimentoGiorno: 'Giorno di riferimento',
  riferimentoMese: 'Mese di riferimento',
  periodoScadenze: 'Periodo delle scadenze',
  periodoExtraDal: 'Periodo extra dal',
  periodoExtraAl: 'Periodo extra al',
  stimaAnnuaKg: 'Stima annua (kg)',
  cerProposta: 'CER proposti',
  addebitiProposti: 'Addebiti proposti',
  appunti: 'Appunti',
  notaUsoInterno: 'Nota per uso interno',
  scaglioni: 'Fasce del prezzo speciale',
  scadenze: 'Scadenze',
}

// ---------------------------------------------------------------------------------------------
// Campi per famiglia (D9)
// ---------------------------------------------------------------------------------------------

const COMUNI: readonly CampoRiga[] = [
  'tipo',
  'riferimento',
  'descrizione',
  'unitaMisura',
  'prezzo',
  'codiceIvaId',
  'provvigione',
  'tipoProvvigione',
  'categoriaId',
  'centroRicavoId',
  'appunti',
  'notaUsoInterno',
]
const PREZZO_SPECIALE: readonly CampoRiga[] = [
  'prezzoSpeciale',
  'applicaA',
  'condizioniRiferite',
  'scaglioni',
  'riferimentoGiorno',
  'riferimentoMese',
]
const MINIMO: readonly CampoRiga[] = ['minimoFatturabile', 'minimoPerCategoria']

/**
 * Quali campi valgono per ogni famiglia (D9). Un campo fuori elenco deve essere vuoto: lo sconto
 * manca nei minimi e negli acconti, la provvigione si limita ai soli `$D`/`$R` in `validaRiga`
 * (la famiglia `ACCONTO` comprende anche `$A`).
 */
export const CAMPI_PER_FAMIGLIA: Readonly<Record<FamigliaAddebito, readonly CampoRiga[]>> = {
  CER: [
    ...COMUNI,
    'cerCode',
    'sconto',
    'tipoQuantita',
    'tipologiaRifiuto',
    'statoFisico',
    'operazione',
    'addebitiProposti',
    'stimaAnnuaKg',
    'condizione',
    ...PREZZO_SPECIALE,
    ...MINIMO,
  ],
  VARIABILE: [
    ...COMUNI,
    'addebitoId',
    'sconto',
    'tipoQuantita',
    'cerProposta',
    'stimaAnnuaKg',
    'condizione',
    ...PREZZO_SPECIALE,
    ...MINIMO,
  ],
  FISSO: [
    ...COMUNI,
    'addebitoId',
    'sconto',
    'quantitaFissa',
    'condizione',
    'periodoScadenze',
    'periodoExtraDal',
    'periodoExtraAl',
    'scadenze',
  ],
  QUANTITA_MOVIMENTI: [...COMUNI, 'addebitoId', 'sconto', 'condizione', ...PREZZO_SPECIALE],
  CONTEGGIO: [...COMUNI, 'addebitoId', 'sconto', 'condizione', ...PREZZO_SPECIALE],
  MINIMO: [...COMUNI, 'addebitoId'],
  ACCONTO: [...COMUNI, 'addebitoId'],
}

const MSG_TIPO = 'Tipo di addebito non ammesso.'
const MSG_SCONTO_NO = 'Per questo tipo di addebito non si indica lo sconto.'
const MSG_PROVVIGIONE_NO = 'Per questo tipo di addebito non si indica la provvigione.'
const MSG_CER_NO_ADDEBITO = 'Una riga CER non ha un addebito.'
const MSG_ADDEBITO_NO_CER = 'Il codice CER si indica solo nelle righe CER.'
const MSG_CER_FORMA = 'Il codice CER non è nel catalogo o indica un capitolo.'
const MSG_SPECIALE_SOLO = 'I dati del prezzo speciale si indicano solo con il prezzo speciale.'

/** Messaggio di un campo che non vale per il tipo (D9); con testi propri per i casi di D10. */
function messaggioFuoriFamiglia(campo: CampoRiga, tipo: string): string {
  if (campo === 'sconto') return MSG_SCONTO_NO
  if (campo === 'addebitoId') return MSG_CER_NO_ADDEBITO
  if (campo === 'cerCode') return MSG_ADDEBITO_NO_CER
  return `Il campo ${ETICHETTE_CAMPI_RIGA[campo]} non vale per gli addebiti di tipo ${tipo}.`
}

function vuoto(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true
  if (typeof v === 'string') return v === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

// ---------------------------------------------------------------------------------------------
// CER (R35)
// ---------------------------------------------------------------------------------------------

/**
 * Forma del catalogo: sei cifre ("NN NN NN", con "*" finale se pericoloso) ottenute con
 * `cerCanonico`, e non di capitolo o sottocapitolo (`NN NN 00`, `NN 00 00`). Controlla solo la
 * forma: l'esistenza nel catalogo la verifica il servizio.
 */
export function formaCerValida(cer: string): boolean {
  if (typeof cer !== 'string') return false
  if (!/^[0-9.]+\*?$/.test(cer.replace(/\s+/g, ''))) return false
  const canonico = cerCanonico(cer)
  return /^\d{2} \d{2} \d{2}\*?$/.test(canonico) && canonico.slice(6, 8) !== '00'
}

/** Tipologia proposta dal codice: capitolo 20 urbano, asterisco pericoloso. */
export function tipologiaDaCer(cer: string): TipologiaRifiuto {
  const canonico = cerCanonico(cer)
  const pericoloso = canonico.endsWith('*')
  const urbano = canonico.startsWith('20')
  if (urbano) return pericoloso ? 'URBANO_PERICOLOSO' : 'URBANO'
  return pericoloso ? 'SPECIALE_PERICOLOSO' : 'SPECIALE'
}

const MAX_PROPOSTE = 50
const MAX_ELEMENTO_CER_PROPOSTA = 20
const MAX_RIFERIMENTO = 8

/**
 * Elementi di `cerProposta` (D9): `CER`, `CER/RIF`, `CER/*` (tutti i riferimenti) e `CER/`
 * (riferimento vuoto). Al massimo 50 elementi di 20 caratteri. I messaggi portano la posizione
 * dell'elemento, mai il suo contenuto.
 */
export function validaCerProposta(v: readonly string[]): string[] {
  const m: string[] = []
  if (v.length > MAX_PROPOSTE) m.push('I codici CER proposti sono al massimo 50.')
  v.forEach((el, i) => {
    const n = i + 1
    if (typeof el !== 'string' || el.length > MAX_ELEMENTO_CER_PROPOSTA) {
      m.push(`CER proposto ${n}: l’elemento non può superare 20 caratteri.`)
      return
    }
    const barra = el.indexOf('/')
    const cer = barra < 0 ? el : el.slice(0, barra)
    if (!formaCerValida(cer)) {
      m.push(`CER proposto ${n}: il codice CER non è nel catalogo o indica un capitolo.`)
      return
    }
    if (barra >= 0) {
      const rif = el.slice(barra + 1)
      if (rif.length > MAX_RIFERIMENTO) {
        m.push(`CER proposto ${n}: il riferimento non può superare 8 caratteri.`)
      } else if (rif.startsWith(' ')) {
        m.push(`CER proposto ${n}: il riferimento non può iniziare con uno spazio.`)
      }
    }
  })
  return m
}

function validaAddebitiProposti(v: readonly string[]): string[] {
  const m: string[] = []
  if (v.length > MAX_PROPOSTE) m.push('Gli addebiti proposti sono al massimo 50.')
  v.forEach((el, i) => {
    if (typeof el !== 'string' || el.trim() === '')
      m.push(`Addebito proposto ${i + 1}: indica il codice.`)
    else if (el.length > 5)
      m.push(`Addebito proposto ${i + 1}: il codice non può superare 5 caratteri.`)
  })
  return m
}

// ---------------------------------------------------------------------------------------------
// Normalizzazione (R35, R37)
// ---------------------------------------------------------------------------------------------

function testo(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Decimale come stringa col punto. Un valore non numerico resta com'e' (lo rifiuta la validazione). */
function decimale(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NaN'
  if (typeof v !== 'string') return 'NaN'
  const t = v.trim().replace(',', '.')
  return t === '' ? null : t
}

function intero(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v.trim() === '' ? null : Number(v.trim())
  return Number.NaN
}

function dataIso(v: unknown): string | null {
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? 'data non valida' : v.toISOString().slice(0, 10)
  const t = testo(v)
  if (t === null) return null
  return /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(t) ? t.slice(0, 10) : t
}

const maiuscolo = (v: unknown): string | null => testo(v)?.toUpperCase() ?? null

function elencoStringhe(v: unknown, mappa: (s: string) => string): string[] {
  if (!Array.isArray(v)) return []
  return v.map(x => (typeof x === 'string' ? mappa(x.trim()) : ''))
}

/** "200301/R1" -> "20 03 01/R1": il CER di ogni elemento nella forma del catalogo (R35). */
function cerPropostoCanonico(el: string): string {
  const barra = el.indexOf('/')
  return barra < 0 ? cerCanonico(el) : `${cerCanonico(el.slice(0, barra))}${el.slice(barra)}`
}

function oggetto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function scaglioni(v: unknown): Scaglione[] {
  if (!Array.isArray(v)) return []
  return v
    .map(x => {
      const o = oggetto(x)
      return {
        ordine: intero(o.ordine) ?? Number.NaN,
        finoA: decimale(o.finoA),
        prezzo: decimale(o.prezzo) ?? '',
        sconto: normalizzaCascata(o.sconto),
        provvigione: normalizzaCascata(o.provvigione),
        tipoCalcolo: (maiuscolo(o.tipoCalcolo) ?? '') as TipoCalcoloScaglione,
      }
    })
    .sort((a, b) => a.ordine - b.ordine)
}

function scadenze(v: unknown): Scadenza[] {
  if (!Array.isArray(v)) return []
  return v
    .map(x => {
      const o = oggetto(x)
      return {
        ordine: intero(o.ordine) ?? Number.NaN,
        giorno: intero(o.giorno) ?? Number.NaN,
        mese: intero(o.mese) ?? Number.NaN,
        anno: intero(o.anno),
      }
    })
    .sort((a, b) => a.ordine - b.ordine)
}

/** Valore vuoto di ogni campo, per i campi che non valgono per la famiglia. */
function vuotoDi(campo: CampoRiga): DatiRiga[CampoRiga] {
  switch (campo) {
    case 'prezzoSpeciale':
    case 'minimoPerCategoria':
      return false
    case 'cerProposta':
    case 'addebitiProposti':
    case 'scaglioni':
    case 'scadenze':
      return []
    case 'unitaMisura':
    case 'tipo':
      return ''
    default:
      return null
  }
}

/**
 * Porta il corpo grezzo ai dati della riga (R35, R36, R37).
 *
 * `inviati` sono le chiavi del corpo (per il PATCH le sole chiavi del patch, con `g` = riga di
 * prima unita' al patch). Un campo che non vale per la famiglia: se non e' inviato, o e' inviato
 * vuoto (`null`, `''`, `[]`, `false`), diventa vuoto senza errore; se e' inviato con un valore e'
 * un errore sul campo e il dato e' scartato. Le stringhe vuote diventano `null` (anche il
 * riferimento e il periodo extra), il CER prende la forma del catalogo, la tipologia e' proposta
 * dal CER se manca. Con il prezzo speciale spento fasce, "si applica a" e riferimento non inviati
 * si svuotano; se inviati con un valore li rifiuta `validaRiga`.
 */
export function normalizzaRiga(
  g: Readonly<Record<string, unknown>>,
  inviati: ReadonlySet<string>
): { dati: DatiRiga; errori: ErroreRiga[] } {
  const riferimento = ((): string | null => {
    const v = g.riferimento
    if (typeof v === 'number') return String(v)
    return typeof v === 'string' && v !== '' ? v : null
  })()
  const dati: DatiRiga = {
    tipo: maiuscolo(g.tipo) ?? '',
    cerCode: ((): string | null => {
      const t = testo(g.cerCode)
      return t === null ? null : cerCanonico(t)
    })(),
    addebitoId: testo(g.addebitoId),
    riferimento,
    descrizione: testo(g.descrizione),
    tipoQuantita: maiuscolo(g.tipoQuantita) as TipoQuantita | null,
    quantitaFissa: decimale(g.quantitaFissa),
    unitaMisura: maiuscolo(g.unitaMisura) ?? '',
    prezzo: decimale(g.prezzo),
    prezzoSpeciale: g.prezzoSpeciale === true,
    sconto: normalizzaCascata(g.sconto),
    codiceIvaId: testo(g.codiceIvaId),
    provvigione: normalizzaCascata(g.provvigione),
    tipoProvvigione: maiuscolo(g.tipoProvvigione) as TipoProvvigione | null,
    tipologiaRifiuto: maiuscolo(g.tipologiaRifiuto) as TipologiaRifiuto | null,
    statoFisico: testo(g.statoFisico),
    operazione: testo(g.operazione),
    categoriaId: testo(g.categoriaId),
    centroRicavoId: testo(g.centroRicavoId),
    applicaA: maiuscolo(g.applicaA) as ApplicaPrezzoSpeciale | null,
    condizione: intero(g.condizione),
    condizioniRiferite: maiuscolo(g.condizioniRiferite),
    minimoFatturabile: decimale(g.minimoFatturabile),
    minimoPerCategoria: g.minimoPerCategoria === true,
    riferimentoGiorno: intero(g.riferimentoGiorno),
    riferimentoMese: intero(g.riferimentoMese),
    periodoScadenze: maiuscolo(g.periodoScadenze) as PeriodoScadenze | null,
    periodoExtraDal: dataIso(g.periodoExtraDal),
    periodoExtraAl: dataIso(g.periodoExtraAl),
    stimaAnnuaKg: decimale(g.stimaAnnuaKg),
    cerProposta: elencoStringhe(g.cerProposta, cerPropostoCanonico),
    addebitiProposti: elencoStringhe(g.addebitiProposti, s => s),
    appunti: testo(g.appunti),
    notaUsoInterno: testo(g.notaUsoInterno),
    scaglioni: scaglioni(g.scaglioni),
    scadenze: scadenze(g.scadenze),
  }

  const errori: ErroreRiga[] = []
  if (tipoAddebitoValido(dati.tipo)) {
    const ammessi = new Set<CampoRiga>(CAMPI_PER_FAMIGLIA[famigliaTipo(dati.tipo)])
    const scrivibile = dati as unknown as Record<CampoRiga, unknown>
    for (const campo of Object.keys(ETICHETTE_CAMPI_RIGA) as CampoRiga[]) {
      if (ammessi.has(campo)) continue
      if (inviati.has(campo) && !vuoto(scrivibile[campo])) {
        errori.push({ campo, messaggio: messaggioFuoriFamiglia(campo, dati.tipo) })
      }
      scrivibile[campo] = vuotoDi(campo)
    }
    if (ammessi.has('prezzoSpeciale') && !dati.prezzoSpeciale) {
      if (!inviati.has('scaglioni')) dati.scaglioni = []
      if (!inviati.has('applicaA')) dati.applicaA = null
      if (!inviati.has('condizioniRiferite')) dati.condizioniRiferite = null
      if (!inviati.has('riferimentoGiorno')) dati.riferimentoGiorno = null
      if (!inviati.has('riferimentoMese')) dati.riferimentoMese = null
    }
    if (
      dati.tipo === 'CER' &&
      dati.tipologiaRifiuto === null &&
      dati.cerCode !== null &&
      formaCerValida(dati.cerCode)
    ) {
      dati.tipologiaRifiuto = tipologiaDaCer(dati.cerCode)
    }
  }
  return { dati, errori }
}

// ---------------------------------------------------------------------------------------------
// Validazione (D10, D12, D14, D17)
// ---------------------------------------------------------------------------------------------

const PREZZO_RE = /^\d{1,8}(\.\d{1,6})?$/
const QUANTITA_FISSA_RE = /^\d{1,9}(\.\d{1,3})?$/
const DUE_DECIMALI_RE = /^\d{1,10}(\.\d{1,2})?$/
const UNITA_RE = /^[A-Z0-9/%#]{1,3}$/
const TIPI_QUANTITA: readonly string[] = ['PESO_NETTO', 'PESO_LORDO', 'VOLUME', 'UNO', 'ALTRO']
const TIPOLOGIE: readonly string[] = [
  'URBANO',
  'URBANO_PERICOLOSO',
  'SPECIALE',
  'SPECIALE_PERICOLOSO',
]
const PERIODI: readonly string[] = [
  'MP', 'BA', 'BP', 'TA', 'TP', 'QA', 'QP', 'SA', 'SP', 'AA', 'AP', 'DA', 'DP', 'XA', 'XD', 'YC',
] // prettier-ignore
const MESSAGGIO_CASCATA_SCONTO =
  'Lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.'
const MESSAGGIO_CASCATA_PROVVIGIONE =
  'La provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.'

/** Campo a cui attribuire i messaggi di `validaPrezzoSpeciale` che non sono delle fasce (R36). */
const CAMPO_MESSAGGIO_PREZZO_SPECIALE: Readonly<Record<string, CampoRiga | null>> = {
  'Indica a cosa si applica il prezzo speciale.': 'applicaA',
  'Il prezzo speciale non si usa negli addebiti condizionati.': 'condizione',
  'Il prezzo speciale non si usa con l’unità di misura HR.': 'unitaMisura',
  'Con il prezzo speciale lo sconto e la provvigione si indicano nelle fasce.': null,
  'Con il prezzo speciale non si indica il minimo fatturabile.': 'minimoFatturabile',
  'Con l’unità K/M o K/L il prezzo speciale si applica al documento.': 'applicaA',
  'Con le condizioni il prezzo speciale si applica al documento o al periodo.': 'applicaA',
  'Per il conguaglio indica la data (giorno e mese).': 'riferimentoGiorno',
  'La data di riferimento vale solo per il progressivo da data e per il conguaglio.':
    'riferimentoGiorno',
  'Il riferimento si indica con giorno e mese insieme.': 'riferimentoGiorno',
  'Il riferimento non è una data valida.': 'riferimentoGiorno',
  'Indica su cosa si calcola la provvigione.': 'tipoProvvigione',
  'Le condizioni si scrivono come cifre da 1 a 9 tutte diverse seguite da C o P (es. 12C).':
    'condizioniRiferite',
}

/**
 * Regole della riga (D10 nell'ordine dei campi, D12 e D14 tramite i moduli dei Task 16a e 18,
 * D17). Restituisce tutti gli errori, ciascuno col suo campo (R36). `contrattoAllegato`: il
 * contratto ha un contratto principale (D17).
 *
 * Il prezzo speciale e le scadenze si validano solo per le famiglie che li ammettono. Una
 * quantita' negativa (quantita' fissa, stima annua) e' rifiutata qui con un messaggio chiaro,
 * cosi' `applicaScaglioni` non la incontra mai (con condizione `C` lancerebbe l'errore generico).
 */
export function validaRiga(d: DatiRiga, contesto: { contrattoAllegato: boolean }): ErroreRiga[] {
  const errori: ErroreRiga[] = []
  const e = (campo: CampoRiga | null, messaggio: string): void => {
    errori.push({ campo, messaggio })
  }

  if (!tipoAddebitoValido(d.tipo)) {
    e('tipo', MSG_TIPO)
    return errori
  }
  const famiglia = famigliaTipo(d.tipo)
  const ammessi = new Set<CampoRiga>(CAMPI_PER_FAMIGLIA[famiglia])
  const eCer = d.tipo === 'CER'

  // D17: contratto allegato
  if (contesto.contrattoAllegato) {
    if (eCer) e('tipo', 'In un contratto allegato non si inseriscono righe CER.')
    else if (d.tipo[0] !== 'T') {
      e('tipo', 'In un contratto allegato si inseriscono solo addebiti di tipo T.')
    }
  }

  // Campi che non valgono per il tipo (il database impone che siano vuoti)
  const valori = d as unknown as Record<CampoRiga, unknown>
  for (const campo of Object.keys(ETICHETTE_CAMPI_RIGA) as CampoRiga[]) {
    if (ammessi.has(campo) || vuoto(valori[campo])) continue
    if (campo === 'addebitoId' || campo === 'cerCode') continue // sotto, con il loro testo
    e(campo, messaggioFuoriFamiglia(campo, d.tipo))
  }

  // Codice CER / addebito
  if (eCer) {
    if (d.cerCode === null || d.cerCode === '') e('cerCode', 'Indica il codice CER.')
    else if (!formaCerValida(d.cerCode) || d.cerCode.length > 10) e('cerCode', MSG_CER_FORMA)
    if (!vuoto(d.addebitoId)) e('addebitoId', MSG_CER_NO_ADDEBITO)
  } else {
    if (vuoto(d.addebitoId)) e('addebitoId', 'Indica l’addebito.')
    if (!vuoto(d.cerCode)) e('cerCode', MSG_ADDEBITO_NO_CER)
  }

  // Riferimento
  if (d.riferimento !== null) {
    if (d.riferimento === '') e('riferimento', 'Il riferimento, se indicato, non può essere vuoto.')
    else {
      if (d.riferimento.length > MAX_RIFERIMENTO) {
        e('riferimento', 'Il riferimento non può superare 8 caratteri.')
      }
      if (d.riferimento.startsWith(' ')) {
        e('riferimento', 'Il riferimento non può iniziare con uno spazio.')
      }
    }
  }
  if (d.descrizione !== null && d.descrizione.length > 45) {
    e('descrizione', 'La descrizione non può superare 45 caratteri.')
  }

  // Quantita'
  if (ammessi.has('tipoQuantita')) {
    if (d.tipoQuantita === null) e('tipoQuantita', 'Indica la quantità.')
    else if (!TIPI_QUANTITA.includes(d.tipoQuantita)) {
      e('tipoQuantita', 'Il tipo di quantità non è ammesso.')
    }
  }
  if (d.quantitaFissa !== null) {
    if (/^-\d/.test(d.quantitaFissa))
      e('quantitaFissa', 'La quantità fissa non può essere negativa.')
    else if (!QUANTITA_FISSA_RE.test(d.quantitaFissa)) {
      e('quantitaFissa', 'La quantità fissa è un numero con al massimo tre decimali.')
    }
  }

  // Unita' di misura
  const um = d.unitaMisura
  if (um === '') e('unitaMisura', 'Indica l’unità di misura.')
  else if (!UNITA_RE.test(um)) {
    e(
      'unitaMisura',
      'L’unità di misura non è valida: al massimo tre caratteri tra lettere maiuscole, cifre e / % #.'
    )
  } else {
    if ((um === '%' || um === '#') && d.tipo !== '$D') {
      e('unitaMisura', 'Le unità % e # valgono solo per le detrazioni ($D).')
    }
    if ((um === 'K/M' || um === 'K/L') && d.tipoQuantita !== 'ALTRO') {
      e('unitaMisura', 'Con l’unità K/M o K/L la quantità è «Altro».')
    }
    if (d.tipoQuantita === 'PESO_NETTO' && !['KG', 'TON', 'GR'].includes(um)) {
      e(
        'unitaMisura',
        'Per una quantità a peso l’unità di misura è KG o TON (GR solo per il peso netto).'
      )
    } else if (d.tipoQuantita === 'PESO_LORDO' && !['KG', 'TON'].includes(um)) {
      e(
        'unitaMisura',
        'Per una quantità a peso l’unità di misura è KG o TON (GR solo per il peso netto).'
      )
    } else if (d.tipoQuantita === 'VOLUME' && !['LT', 'MC'].includes(um)) {
      e('unitaMisura', 'Per una quantità a volume l’unità di misura è LT o MC.')
    }
  }

  // Prezzo
  if (d.prezzo === null) {
    if (!d.prezzoSpeciale) e('prezzo', 'Indica il prezzo, anche zero.')
  } else if (!PREZZO_RE.test(d.prezzo)) {
    e('prezzo', 'Il prezzo deve essere un numero non negativo con al massimo sei decimali.')
  }
  if (vuoto(d.codiceIvaId)) e('codiceIvaId', 'Indica il codice IVA.')

  // Sconto e provvigione (E10)
  const sconto = normalizzaCascata(d.sconto)
  if (sconto !== null) {
    if (!ammessi.has('sconto')) e('sconto', MSG_SCONTO_NO)
    else if (!cascataValida(sconto) || sconto.length > 20) e('sconto', MESSAGGIO_CASCATA_SCONTO)
  }
  const provvigione = normalizzaCascata(d.provvigione)
  if (provvigione !== null) {
    if (d.tipo === '$D' || d.tipo === '$R') e('provvigione', MSG_PROVVIGIONE_NO)
    else {
      if (!cascataValida(provvigione) || provvigione.length > 20) {
        e('provvigione', MESSAGGIO_CASCATA_PROVVIGIONE)
      }
      if (vuoto(d.tipoProvvigione))
        e('tipoProvvigione', 'Indica su cosa si calcola la provvigione.')
    }
  }
  if (
    d.tipoProvvigione !== null &&
    d.tipoProvvigione !== 'SCONTATO' &&
    d.tipoProvvigione !== 'LORDO'
  ) {
    e('tipoProvvigione', 'Il tipo di provvigione non è ammesso.')
  }

  // Dati del rifiuto (CER)
  if (d.tipologiaRifiuto !== null && !TIPOLOGIE.includes(d.tipologiaRifiuto)) {
    e('tipologiaRifiuto', 'La tipologia del rifiuto non è ammessa.')
  }
  if (d.statoFisico !== null && d.statoFisico.length > 10) {
    e('statoFisico', 'Lo stato fisico non può superare 10 caratteri.')
  }
  if (d.operazione !== null && d.operazione.length > 10) {
    e('operazione', 'L’operazione non può superare 10 caratteri.')
  }

  // Condizione, minimo, stima
  if (
    d.condizione !== null &&
    (!Number.isInteger(d.condizione) || d.condizione < 1 || d.condizione > 9)
  ) {
    e('condizione', 'La condizione è un numero da 1 a 9.')
  }
  if (d.minimoFatturabile !== null && !DUE_DECIMALI_RE.test(d.minimoFatturabile)) {
    e(
      'minimoFatturabile',
      'Il minimo fatturabile è un numero non negativo con al massimo due decimali.'
    )
  }
  if (d.stimaAnnuaKg !== null) {
    if (/^-\d/.test(d.stimaAnnuaKg)) e('stimaAnnuaKg', 'La stima annua non può essere negativa.')
    else if (!DUE_DECIMALI_RE.test(d.stimaAnnuaKg)) {
      e('stimaAnnuaKg', 'La stima annua è un numero con al massimo due decimali.')
    }
  }

  // Prezzo speciale (D12): solo per le famiglie che lo ammettono
  if (ammessi.has('prezzoSpeciale')) {
    if (d.prezzoSpeciale) {
      const delleFasce = new Set(
        validaScaglioni(d.scaglioni, { conCondizioni: !vuoto(d.condizioniRiferite) })
      )
      const visti = new Set<string>()
      for (const m of validaPrezzoSpeciale(d, d.scaglioni)) {
        if (visti.has(m)) continue
        visti.add(m)
        e(delleFasce.has(m) ? 'scaglioni' : (CAMPO_MESSAGGIO_PREZZO_SPECIALE[m] ?? null), m)
      }
    } else {
      if (d.scaglioni.length > 0) e('scaglioni', MSG_SPECIALE_SOLO)
      if (d.applicaA !== null) e('applicaA', MSG_SPECIALE_SOLO)
      if (!vuoto(d.condizioniRiferite)) e('condizioniRiferite', MSG_SPECIALE_SOLO)
      if (d.riferimentoGiorno !== null || d.riferimentoMese !== null) {
        e('riferimentoGiorno', MSG_SPECIALE_SOLO)
      }
    }
  }

  // Elenchi di proposte
  for (const m of validaCerProposta(d.cerProposta)) e('cerProposta', m)
  for (const m of validaAddebitiProposti(d.addebitiProposti)) e('addebitiProposti', m)

  // Testi liberi
  if (d.appunti !== null && d.appunti.length > 135) {
    e('appunti', 'Gli appunti non possono superare 135 caratteri.')
  }
  if (d.notaUsoInterno !== null && d.notaUsoInterno.length > 45) {
    e('notaUsoInterno', 'La nota per uso interno non può superare 45 caratteri.')
  }

  // Scadenze dei fissi (D14). Il periodo e' facoltativo (E19): senza periodo le scadenze restano
  // valide ma non hanno una competenza (`periodoCompetenza` richiede il periodo).
  if (famiglia === 'FISSO') {
    let periodo: PeriodoScadenze | null = null
    if (d.periodoScadenze !== null) {
      if (PERIODI.includes(d.periodoScadenze)) periodo = d.periodoScadenze
      else e('periodoScadenze', 'Il periodo delle scadenze non è ammesso.')
    }
    const extra = { dal: d.periodoExtraDal, al: d.periodoExtraAl }
    const soloScadenze = validaScadenze(d.scadenze, null, { dal: null, al: null })
    const solo = new Set(soloScadenze)
    for (const m of soloScadenze) e('scadenze', m)
    for (const m of validaScadenze(d.scadenze, periodo, extra)) {
      if (!solo.has(m)) e('periodoExtraDal', m)
    }
  }

  return errori
}

// ---------------------------------------------------------------------------------------------
// Chiave e totali
// ---------------------------------------------------------------------------------------------

/**
 * Identita' di una riga nell'elenco (D11): tipo, codice (CER o addebito) e riferimento. Due righe
 * con la stessa chiave sono la stessa riga; il riferimento vuoto e `null` coincidono.
 */
export function chiaveRiga(
  d: Pick<DatiRiga, 'tipo' | 'cerCode' | 'addebitoId' | 'riferimento'>
): string {
  const codice = d.cerCode !== null ? cerCanonico(d.cerCode) : (d.addebitoId ?? '')
  return JSON.stringify([d.tipo, codice, d.riferimento ?? ''])
}

/**
 * `TOTFISSI`: totale annuo degli addebiti fissi. Solo le righe `F` e solo le scadenze "ogni anno"
 * (anno vuoto), come `riempitavola` (`ELENCHIaddeb.cs:2290-2306`). Ogni scadenza vale
 * `quantitaFissa` (vuota = 1) x `prezzo` (mancante = 0) arrotondato a due decimali, come una riga
 * di fattura (`importoRiga`); `quantitaFissa` 0 non fattura.
 */
export function totaleFissiAnnuo(
  righe: readonly {
    tipo: string
    quantitaFissa: string | null
    prezzo: string | null
    scadenze: { anno: number | null }[]
  }[]
): string {
  let totale = new Prisma.Decimal(0)
  for (const r of righe) {
    if (r.tipo !== 'F') continue
    const ogniAnno = r.scadenze.filter(s => s.anno === null).length
    if (ogniAnno === 0) continue
    const importo = importoRiga(r.quantitaFissa ?? '1', r.prezzo ?? '0', null).lordo
    totale = totale.plus(new Prisma.Decimal(importo).times(ogniAnno))
  }
  return totale.toFixed(2)
}
