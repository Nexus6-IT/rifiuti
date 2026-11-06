/**
 * Serializzatore XML FatturaPA FPR12/FPA12 (Task 15, spec §7.2, S11). Dominio puro e
 * deterministico: stessi dati, stessi byte. Gli elementi seguono l'ordine delle sequenze
 * dell'XSD (Specifiche tecniche FatturaPA 1.2.x, Schema_del_file_xml_FatturaPA_v1.2.x.xsd,
 * fatturapa.gov.it): un ordine sbagliato fa scartare il file. La validazione contro l'XSD
 * ufficiale e del Task 16; qui l'ordine e i formati dei numeri sono fissati dai test.
 */
import { Prisma } from '@prisma/client'
import { importoBolloAl } from '../costanti-fiscali'
import type {
  DocumentoPerXml,
  FotografiaDocumento,
  RataCalcolata,
  RigaDocumentoCalcolata,
  RiepilogoIvaCalcolato,
} from '../tipi'
import { normalizzaTesto } from './normalizza-testo'

type Insieme = 'LATIN1' | 'BASIC'

/**
 * Lunghezza massima e insieme di caratteri dell'XSD per ogni elemento di testo (XSD 1.2.3):
 * `LATIN1` = tipi `String*LatinType`, `BASIC` = tipi `String*Type` (solo Basic Latin).
 */
export const LUNGHEZZE_XSD: Readonly<Record<string, { max: number; insieme: Insieme }>> = {
  Denominazione: { max: 80, insieme: 'LATIN1' },
  Nome: { max: 60, insieme: 'LATIN1' },
  Cognome: { max: 60, insieme: 'LATIN1' },
  CodiceFiscale: { max: 16, insieme: 'BASIC' },
  IdCodice: { max: 28, insieme: 'BASIC' },
  IdPaese: { max: 2, insieme: 'BASIC' },
  Indirizzo: { max: 60, insieme: 'LATIN1' },
  CAP: { max: 5, insieme: 'BASIC' },
  Comune: { max: 60, insieme: 'LATIN1' },
  Provincia: { max: 2, insieme: 'BASIC' },
  Nazione: { max: 2, insieme: 'BASIC' },
  Ufficio: { max: 2, insieme: 'BASIC' },
  NumeroREA: { max: 20, insieme: 'BASIC' },
  SocioUnico: { max: 2, insieme: 'BASIC' },
  StatoLiquidazione: { max: 2, insieme: 'BASIC' },
  RegimeFiscale: { max: 4, insieme: 'BASIC' },
  TipoDocumento: { max: 4, insieme: 'BASIC' },
  Divisa: { max: 3, insieme: 'BASIC' },
  Numero: { max: 20, insieme: 'BASIC' },
  BolloVirtuale: { max: 2, insieme: 'BASIC' },
  Causale: { max: 200, insieme: 'LATIN1' },
  IdDocumento: { max: 20, insieme: 'BASIC' },
  CodiceCUP: { max: 15, insieme: 'BASIC' },
  CodiceCIG: { max: 15, insieme: 'BASIC' },
  Descrizione: { max: 1000, insieme: 'LATIN1' },
  UnitaMisura: { max: 10, insieme: 'BASIC' },
  Tipo: { max: 2, insieme: 'BASIC' },
  Natura: { max: 4, insieme: 'BASIC' },
  EsigibilitaIVA: { max: 1, insieme: 'BASIC' },
  RiferimentoNormativo: { max: 100, insieme: 'LATIN1' },
  TipoDato: { max: 10, insieme: 'BASIC' },
  RiferimentoTesto: { max: 60, insieme: 'BASIC' },
  CondizioniPagamento: { max: 4, insieme: 'BASIC' },
  ModalitaPagamento: { max: 4, insieme: 'BASIC' },
  IstitutoFinanziario: { max: 80, insieme: 'LATIN1' },
  IBAN: { max: 34, insieme: 'BASIC' },
  ABI: { max: 5, insieme: 'BASIC' },
  CAB: { max: 5, insieme: 'BASIC' },
  BIC: { max: 11, insieme: 'BASIC' },
  PECDestinatario: { max: 256, insieme: 'BASIC' },
  ProgressivoInvio: { max: 10, insieme: 'BASIC' },
  FormatoTrasmissione: { max: 5, insieme: 'BASIC' },
  CodiceDestinatario: { max: 7, insieme: 'BASIC' },
}

/**
 * Invariante violata: un campo obbligatorio dell'XSD resta vuoto dopo la normalizzazione. Il
 * Task 17 controlla prima, con gli errori del documento: qui e l'ultima difesa, perche un XML
 * non valido da una fotografia immutabile non si puo piu correggere.
 */
export class CampoXmlObbligatorioVuotoError extends Error {
  constructor(readonly campo: string) {
    super(`Campo XML obbligatorio vuoto dopo la normalizzazione: ${campo}`)
    this.name = 'CampoXmlObbligatorioVuotoError'
  }
}

const NS_P = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2'
const SCHEMA_LOCATION =
  'http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_v1.2.xsd'

export interface DatiFatturaXml {
  trasmissione: {
    idPaese: 'IT'
    idCodice: string
    progressivoInvio: string
    formato: 'FPR12' | 'FPA12'
    codiceDestinatario: string
    pecDestinatario: string | null
  }
  cedente: FotografiaDocumento['cedente']
  cessionario: FotografiaDocumento['cessionario']
  generali: {
    tipoDocumento: string
    data: string
    numero: string
    bollo: { importo: string } | null
    importoTotale: string
    causale: string[]
  }
  contratto: { idDocumento: string | null; cig: string | null; cup: string | null } | null
  fattureCollegate: { idDocumento: string; data: string } | null
  linee: RigaDocumentoCalcolata[]
  riepiloghi: RiepilogoIvaCalcolato[]
  pagamento: { condizioni: 'TP01' | 'TP02'; rate: RataCalcolata[] } | null
}

/** Escape dei caratteri speciali XML nel testo (i testi sono gia normalizzati). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function testoCampo(nome: string, valore: string | null | undefined): string {
  if (valore === null || valore === undefined) return ''
  const campo = LUNGHEZZE_XSD[nome]
  return campo === undefined
    ? normalizzaTesto(valore, Number.MAX_SAFE_INTEGER)
    : normalizzaTesto(valore, campo.max, campo.insieme)
}

/** Elemento facoltativo: normalizzato e troncato (max e insieme dalla tabella); omesso se vuoto. */
function el(nome: string, valore: string | null | undefined): string {
  const t = testoCampo(nome, valore)
  return t === '' ? '' : `<${nome}>${esc(t)}</${nome}>`
}

/** Elemento obbligatorio: se resta vuoto dopo la normalizzazione, errore con il nome del campo. */
function elObbl(nome: string, valore: string | null | undefined): string {
  const t = testoCampo(nome, valore)
  if (t === '') throw new CampoXmlObbligatorioVuotoError(nome)
  return `<${nome}>${esc(t)}</${nome}>`
}

/** Elemento con contenuto gia serializzato; omesso se vuoto. */
function blocco(nome: string, interno: string): string {
  return interno === '' ? '' : `<${nome}>${interno}</${nome}>`
}

/**
 * Decimale col punto con almeno `min` e al massimo `max` cifre decimali (zeri finali oltre `min`
 * tolti). Con `min === max` e a cifre fisse (Amount2DecimalType, Rate2DecimalType).
 */
export function decimaleXml(v: string, min: number, max: number): string {
  const d = new Prisma.Decimal(v).toDecimalPlaces(max, Prisma.Decimal.ROUND_HALF_UP)
  let s = d.toFixed(max)
  if (min < max) {
    const [i, f] = s.split('.')
    s = `${i}.${f.replace(/0+$/, '').padEnd(min, '0')}`
  }
  return s === '-0.00' ? '0.00' : s
}

const importo2 = (v: string): string => decimaleXml(v, 2, 2)
const importo8 = (v: string): string => decimaleXml(v, 2, 8)

function num(nome: string, valore: string): string {
  return `<${nome}>${valore}</${nome}>`
}

/** Sigla di due lettere (provincia, ufficio REA), in maiuscolo; null se non e di due lettere. */
function siglaDueLettere(v: string | null): string | null {
  const t = v === null ? '' : v.trim()
  return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : null
}

function sede(s: FotografiaDocumento['cedente']['sede']): string {
  const provincia = siglaDueLettere(s.provincia) // facoltativa: se non e una sigla si omette
  return blocco(
    'Sede',
    elObbl('Indirizzo', s.indirizzo) +
      elObbl('CAP', s.cap) +
      elObbl('Comune', s.comune) +
      (provincia !== null ? el('Provincia', provincia) : '') +
      elObbl('Nazione', s.nazione)
  )
}

function idFiscaleIva(partitaIva: string): string {
  return blocco('IdFiscaleIVA', elObbl('IdPaese', 'IT') + elObbl('IdCodice', partitaIva))
}

function codiceFiscale(cf: string | null): string {
  return el('CodiceFiscale', cf === null ? null : cf.toUpperCase())
}

function cedente(c: FotografiaDocumento['cedente']): string {
  let rea = ''
  if (c.rea !== null && c.rea.ufficio.trim() !== '') {
    const ufficio = siglaDueLettere(c.rea.ufficio)
    if (ufficio === null) throw new CampoXmlObbligatorioVuotoError('Ufficio')
    rea = blocco(
      'IscrizioneREA',
      elObbl('Ufficio', ufficio) +
        elObbl('NumeroREA', c.rea.numero) +
        (c.rea.capitaleSociale !== null
          ? num('CapitaleSociale', importo2(c.rea.capitaleSociale))
          : '') +
        el('SocioUnico', c.rea.socioUnico) +
        elObbl('StatoLiquidazione', c.rea.statoLiquidazione)
    )
  }
  return blocco(
    'CedentePrestatore',
    blocco(
      'DatiAnagrafici',
      idFiscaleIva(c.partitaIva) +
        codiceFiscale(c.codiceFiscale) +
        blocco('Anagrafica', elObbl('Denominazione', c.denominazione)) +
        elObbl('RegimeFiscale', c.regimeFiscale)
    ) +
      sede(c.sede) +
      rea
  )
}

function cessionario(c: FotografiaDocumento['cessionario']): string {
  const denominazione = testoCampo('Denominazione', c.denominazione)
  const anagrafica =
    denominazione !== ''
      ? elObbl('Denominazione', c.denominazione)
      : elObbl('Nome', c.nome) + elObbl('Cognome', c.cognome)
  const partitaIva = c.partitaIva !== null && c.partitaIva.trim() !== '' ? c.partitaIva : null
  const cf = codiceFiscale(c.codiceFiscale)
  if (partitaIva === null && cf === '') throw new CampoXmlObbligatorioVuotoError('IdFiscaleIVA')
  return blocco(
    'CessionarioCommittente',
    blocco(
      'DatiAnagrafici',
      (partitaIva !== null ? idFiscaleIva(partitaIva) : '') + cf + blocco('Anagrafica', anagrafica)
    ) + sede(c.sede)
  )
}

/** Un blocco di `Causale` ogni 200 caratteri, per ogni riga del testo di fatturazione. */
function causali(righe: readonly string[]): string {
  const max = LUNGHEZZE_XSD.Causale.max
  let out = ''
  for (const r of righe) {
    const t = normalizzaTesto(r, Number.MAX_SAFE_INTEGER)
    for (let i = 0; i < t.length; i += max) {
      const pezzo = t.slice(i, i + max).trim()
      if (pezzo !== '') out += `<Causale>${esc(pezzo)}</Causale>`
    }
  }
  return out
}

function contratto(c: NonNullable<DatiFatturaXml['contratto']>): string {
  // IdDocumento e obbligatorio nell'XSD: senza, i dati PA non si possono emettere.
  if (c.idDocumento === null || c.idDocumento.trim() === '') return ''
  return blocco(
    'DatiContratto',
    elObbl('IdDocumento', c.idDocumento) + el('CodiceCUP', c.cup) + el('CodiceCIG', c.cig)
  )
}

/** Percentuale di sconto: l'XSD (RateType) ha 2 decimali fissi, quindi non si arrotonda in silenzio. */
function percentualeSconto(t: string): string {
  const d = new Prisma.Decimal(t)
  if (!d.equals(d.toDecimalPlaces(2))) {
    throw new Error(`Sconto con piu di 2 decimali non rappresentabile nell'XML: ${t}`)
  }
  return decimaleXml(t, 2, 2)
}

function linea(r: RigaDocumentoCalcolata): string {
  const sconti = (r.sconto ?? '')
    .split('+')
    .filter(t => t !== '')
    .map(t =>
      blocco('ScontoMaggiorazione', elObbl('Tipo', 'SC') + num('Percentuale', percentualeSconto(t)))
    )
    .join('')
  const natura = r.naturaIva !== null && r.naturaIva !== '' ? el('Natura', r.naturaIva) : ''
  const fir =
    r.numeroFir !== null && r.numeroFir.trim() !== ''
      ? blocco(
          'AltriDatiGestionali',
          elObbl('TipoDato', 'FIR') + el('RiferimentoTesto', r.numeroFir)
        )
      : ''
  return blocco(
    'DettaglioLinee',
    num('NumeroLinea', String(r.numeroLinea)) +
      elObbl('Descrizione', r.descrizione) +
      (r.quantita !== null ? num('Quantita', importo8(r.quantita)) : '') +
      (r.quantita !== null ? el('UnitaMisura', r.unitaMisura) : '') +
      num('PrezzoUnitario', importo8(r.prezzoUnitario)) +
      sconti +
      num('PrezzoTotale', importo8(r.prezzoTotale)) +
      num('AliquotaIVA', decimaleXml(r.aliquotaIva, 2, 2)) +
      natura +
      fir
  )
}

function riepilogo(r: RiepilogoIvaCalcolato): string {
  return blocco(
    'DatiRiepilogo',
    num('AliquotaIVA', decimaleXml(r.aliquota, 2, 2)) +
      (r.natura !== null && r.natura !== '' ? el('Natura', r.natura) : '') +
      num('ImponibileImporto', importo2(r.imponibile)) +
      num('Imposta', importo2(r.imposta)) +
      elObbl('EsigibilitaIVA', r.esigibilita) +
      el('RiferimentoNormativo', r.riferimentoNormativo)
  )
}

function pagamento(p: NonNullable<DatiFatturaXml['pagamento']>): string {
  if (p.rate.length === 0) return ''
  const dettagli = p.rate
    .map(r =>
      blocco(
        'DettaglioPagamento',
        elObbl('ModalitaPagamento', r.modalita) +
          num('DataScadenzaPagamento', r.dataScadenza) +
          num('ImportoPagamento', importo2(r.importo)) +
          el('IstitutoFinanziario', r.istituto) +
          el('IBAN', r.iban) +
          el('ABI', r.abi) +
          el('CAB', r.cab) +
          el('BIC', r.bic)
      )
    )
    .join('')
  return blocco('DatiPagamento', elObbl('CondizioniPagamento', p.condizioni) + dettagli)
}

/**
 * XML FatturaPA (UTF-8, senza spazi non significativi, importi col punto). Lancia
 * `CampoXmlObbligatorioVuotoError` se un campo obbligatorio resta vuoto dopo la normalizzazione.
 */
export function serializzaFattura(d: DatiFatturaXml): string {
  const t = d.trasmissione
  const trasmissione = blocco(
    'DatiTrasmissione',
    blocco('IdTrasmittente', elObbl('IdPaese', t.idPaese) + elObbl('IdCodice', t.idCodice)) +
      elObbl('ProgressivoInvio', t.progressivoInvio) +
      elObbl('FormatoTrasmissione', t.formato) +
      elObbl('CodiceDestinatario', t.codiceDestinatario) +
      (t.codiceDestinatario === '0000000' ? el('PECDestinatario', t.pecDestinatario) : '')
  )
  const header = blocco(
    'FatturaElettronicaHeader',
    trasmissione + cedente(d.cedente) + cessionario(d.cessionario)
  )

  const g = d.generali
  const generali = blocco(
    'DatiGenerali',
    blocco(
      'DatiGeneraliDocumento',
      elObbl('TipoDocumento', g.tipoDocumento) +
        elObbl('Divisa', 'EUR') +
        num('Data', g.data) +
        elObbl('Numero', g.numero) +
        (g.bollo !== null
          ? blocco(
              'DatiBollo',
              elObbl('BolloVirtuale', 'SI') + num('ImportoBollo', importo2(g.bollo.importo))
            )
          : '') +
        num('ImportoTotaleDocumento', importo2(g.importoTotale)) +
        causali(g.causale)
    ) +
      (d.contratto !== null ? contratto(d.contratto) : '') +
      (d.fattureCollegate !== null
        ? blocco(
            'DatiFattureCollegate',
            elObbl('IdDocumento', d.fattureCollegate.idDocumento) +
              num('Data', d.fattureCollegate.data)
          )
        : '')
  )
  const beniServizi = blocco(
    'DatiBeniServizi',
    d.linee.map(linea).join('') + d.riepiloghi.map(riepilogo).join('')
  )
  const body = blocco(
    'FatturaElettronicaBody',
    generali + beniServizi + (d.pagamento !== null ? pagamento(d.pagamento) : '')
  )

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<p:FatturaElettronica versione="${t.formato}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ` +
    `xmlns:p="${NS_P}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="${NS_P} ${SCHEMA_LOCATION}">` +
    header +
    body +
    '</p:FatturaElettronica>'
  )
}

/**
 * Dati dell'XML dalla fotografia e dalle righe salvate. `DatiBollo` vale `testata.importoBollo`
 * salvato alla definitiva; se manca (non dovrebbe) ripiega su `importoBolloAl` alla data.
 */
export function datiFatturaDaDocumento(
  doc: DocumentoPerXml,
  progressivoFile: string
): DatiFatturaXml {
  const { testata: t, fotografia: f } = doc
  const haDatiContratto = f.idDocumento !== null || f.cig !== null || f.cup !== null
  return {
    trasmissione: {
      idPaese: 'IT',
      idCodice: f.cedente.idTrasmittente,
      progressivoInvio: progressivoFile,
      formato: t.formatoTrasmissione,
      codiceDestinatario: t.codiceDestinatario,
      pecDestinatario: t.pecDestinatario,
    },
    cedente: f.cedente,
    cessionario: f.cessionario,
    generali: {
      tipoDocumento: t.tipoDocumento,
      data: t.dataDocumento,
      numero: t.numeroTesto,
      bollo: t.bolloDovuto ? { importo: t.importoBollo ?? importoBolloAl(t.dataDocumento) } : null,
      importoTotale: t.totaleDocumento,
      causale: f.testoFatturazione,
    },
    contratto: haDatiContratto ? { idDocumento: f.idDocumento, cig: f.cig, cup: f.cup } : null,
    fattureCollegate:
      t.origine !== null
        ? { idDocumento: t.origine.numeroTesto, data: t.origine.dataDocumento }
        : null,
    linee: doc.righe,
    riepiloghi: doc.riepiloghi,
    pagamento:
      t.condizioniPagamento !== null && doc.rate.length > 0
        ? { condizioni: t.condizioniPagamento, rate: doc.rate }
        : null,
  }
}
