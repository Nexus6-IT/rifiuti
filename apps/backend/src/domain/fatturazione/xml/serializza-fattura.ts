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

/** Lunghezze massime dell'XSD per campo (caratteri). */
export const LUNGHEZZE_XSD = {
  Denominazione: 80,
  Nome: 60,
  Cognome: 60,
  CodiceFiscale: 16,
  IdCodice: 28,
  Indirizzo: 60,
  NumeroCivico: 8,
  CAP: 5,
  Comune: 60,
  Provincia: 2,
  Ufficio: 2,
  NumeroREA: 20,
  Numero: 20,
  Causale: 200,
  IdDocumento: 20,
  CodiceCUP: 15,
  CodiceCIG: 15,
  Descrizione: 1000,
  UnitaMisura: 10,
  Natura: 4,
  RiferimentoNormativo: 100,
  RiferimentoTesto: 60,
  IstitutoFinanziario: 80,
  IBAN: 34,
  ABI: 5,
  CAB: 5,
  BIC: 11,
  PECDestinatario: 256,
  ProgressivoInvio: 10,
} as const

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

/** Elemento con testo normalizzato e troncato; omesso se resta vuoto. */
function el(nome: string, valore: string | null | undefined, max?: number): string {
  if (valore === null || valore === undefined) return ''
  const t = normalizzaTesto(valore, max ?? Number.MAX_SAFE_INTEGER)
  return t === '' ? '' : `<${nome}>${esc(t)}</${nome}>`
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

function sede(s: FotografiaDocumento['cedente']['sede']): string {
  return blocco(
    'Sede',
    el('Indirizzo', s.indirizzo, LUNGHEZZE_XSD.Indirizzo) +
      el('CAP', s.cap, LUNGHEZZE_XSD.CAP) +
      el('Comune', s.comune, LUNGHEZZE_XSD.Comune) +
      (s.provincia ? el('Provincia', s.provincia.toUpperCase(), LUNGHEZZE_XSD.Provincia) : '') +
      el('Nazione', s.nazione)
  )
}

function idFiscaleIva(partitaIva: string | null): string {
  if (!partitaIva) return ''
  return blocco(
    'IdFiscaleIVA',
    el('IdPaese', 'IT') + el('IdCodice', partitaIva, LUNGHEZZE_XSD.IdCodice)
  )
}

function cedente(c: FotografiaDocumento['cedente']): string {
  const rea =
    c.rea !== null && c.rea.ufficio.trim() !== '' && c.rea.numero.trim() !== ''
      ? blocco(
          'IscrizioneREA',
          el('Ufficio', c.rea.ufficio.toUpperCase(), LUNGHEZZE_XSD.Ufficio) +
            el('NumeroREA', c.rea.numero, LUNGHEZZE_XSD.NumeroREA) +
            (c.rea.capitaleSociale !== null
              ? num('CapitaleSociale', importo2(c.rea.capitaleSociale))
              : '') +
            el('SocioUnico', c.rea.socioUnico) +
            el('StatoLiquidazione', c.rea.statoLiquidazione)
        )
      : ''
  return blocco(
    'CedentePrestatore',
    blocco(
      'DatiAnagrafici',
      idFiscaleIva(c.partitaIva) +
        el('CodiceFiscale', c.codiceFiscale, LUNGHEZZE_XSD.CodiceFiscale) +
        blocco('Anagrafica', el('Denominazione', c.denominazione, LUNGHEZZE_XSD.Denominazione)) +
        el('RegimeFiscale', c.regimeFiscale)
    ) +
      sede(c.sede) +
      rea
  )
}

function cessionario(c: FotografiaDocumento['cessionario']): string {
  const anagrafica =
    c.denominazione !== null && c.denominazione.trim() !== ''
      ? el('Denominazione', c.denominazione, LUNGHEZZE_XSD.Denominazione)
      : el('Nome', c.nome, LUNGHEZZE_XSD.Nome) + el('Cognome', c.cognome, LUNGHEZZE_XSD.Cognome)
  return blocco(
    'CessionarioCommittente',
    blocco(
      'DatiAnagrafici',
      idFiscaleIva(c.partitaIva) +
        el('CodiceFiscale', c.codiceFiscale, LUNGHEZZE_XSD.CodiceFiscale) +
        blocco('Anagrafica', anagrafica)
    ) + sede(c.sede)
  )
}

/** Un blocco di `Causale` ogni 200 caratteri, per ogni riga del testo di fatturazione. */
function causali(righe: readonly string[]): string {
  let out = ''
  for (const r of righe) {
    const t = normalizzaTesto(r, Number.MAX_SAFE_INTEGER)
    for (let i = 0; i < t.length; i += LUNGHEZZE_XSD.Causale) {
      const pezzo = t.slice(i, i + LUNGHEZZE_XSD.Causale).trim()
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
    el('IdDocumento', c.idDocumento, LUNGHEZZE_XSD.IdDocumento) +
      el('CodiceCUP', c.cup, LUNGHEZZE_XSD.CodiceCUP) +
      el('CodiceCIG', c.cig, LUNGHEZZE_XSD.CodiceCIG)
  )
}

function linea(r: RigaDocumentoCalcolata): string {
  const sconti = (r.sconto ?? '')
    .split('+')
    .filter(t => t !== '')
    .map(t =>
      blocco('ScontoMaggiorazione', el('Tipo', 'SC') + num('Percentuale', decimaleXml(t, 2, 2)))
    )
    .join('')
  const natura =
    r.naturaIva !== null && r.naturaIva !== ''
      ? el('Natura', r.naturaIva, LUNGHEZZE_XSD.Natura)
      : ''
  const fir =
    r.numeroFir !== null && r.numeroFir.trim() !== ''
      ? blocco(
          'AltriDatiGestionali',
          el('TipoDato', 'FIR') +
            el('RiferimentoTesto', r.numeroFir, LUNGHEZZE_XSD.RiferimentoTesto)
        )
      : ''
  return blocco(
    'DettaglioLinee',
    num('NumeroLinea', String(r.numeroLinea)) +
      el('Descrizione', r.descrizione === '' ? '-' : r.descrizione, LUNGHEZZE_XSD.Descrizione) +
      (r.quantita !== null ? num('Quantita', importo8(r.quantita)) : '') +
      (r.quantita !== null ? el('UnitaMisura', r.unitaMisura, LUNGHEZZE_XSD.UnitaMisura) : '') +
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
      (r.natura !== null && r.natura !== '' ? el('Natura', r.natura, LUNGHEZZE_XSD.Natura) : '') +
      num('ImponibileImporto', importo2(r.imponibile)) +
      num('Imposta', importo2(r.imposta)) +
      el('EsigibilitaIVA', r.esigibilita) +
      (r.riferimentoNormativo !== null
        ? el('RiferimentoNormativo', r.riferimentoNormativo, LUNGHEZZE_XSD.RiferimentoNormativo)
        : '')
  )
}

function pagamento(p: NonNullable<DatiFatturaXml['pagamento']>): string {
  if (p.rate.length === 0) return ''
  const dettagli = p.rate
    .map(r =>
      blocco(
        'DettaglioPagamento',
        el('ModalitaPagamento', r.modalita) +
          num('DataScadenzaPagamento', r.dataScadenza) +
          num('ImportoPagamento', importo2(r.importo)) +
          el('IstitutoFinanziario', r.istituto, LUNGHEZZE_XSD.IstitutoFinanziario) +
          el('IBAN', r.iban, LUNGHEZZE_XSD.IBAN) +
          el('ABI', r.abi, LUNGHEZZE_XSD.ABI) +
          el('CAB', r.cab, LUNGHEZZE_XSD.CAB) +
          el('BIC', r.bic, LUNGHEZZE_XSD.BIC)
      )
    )
    .join('')
  return blocco('DatiPagamento', el('CondizioniPagamento', p.condizioni) + dettagli)
}

/** XML FatturaPA (UTF-8, senza spazi non significativi, importi col punto). */
export function serializzaFattura(d: DatiFatturaXml): string {
  const t = d.trasmissione
  const trasmissione = blocco(
    'DatiTrasmissione',
    blocco(
      'IdTrasmittente',
      el('IdPaese', t.idPaese) + el('IdCodice', t.idCodice, LUNGHEZZE_XSD.IdCodice)
    ) +
      el('ProgressivoInvio', t.progressivoInvio, LUNGHEZZE_XSD.ProgressivoInvio) +
      el('FormatoTrasmissione', t.formato) +
      el('CodiceDestinatario', t.codiceDestinatario, 7) +
      (t.codiceDestinatario === '0000000' && t.pecDestinatario
        ? el('PECDestinatario', t.pecDestinatario, LUNGHEZZE_XSD.PECDestinatario)
        : '')
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
      el('TipoDocumento', g.tipoDocumento) +
        el('Divisa', 'EUR') +
        num('Data', g.data) +
        el('Numero', g.numero, LUNGHEZZE_XSD.Numero) +
        (g.bollo !== null
          ? blocco(
              'DatiBollo',
              el('BolloVirtuale', 'SI') + num('ImportoBollo', importo2(g.bollo.importo))
            )
          : '') +
        num('ImportoTotaleDocumento', importo2(g.importoTotale)) +
        causali(g.causale)
    ) +
      (d.contratto !== null ? contratto(d.contratto) : '') +
      (d.fattureCollegate !== null
        ? blocco(
            'DatiFattureCollegate',
            el('IdDocumento', d.fattureCollegate.idDocumento, LUNGHEZZE_XSD.IdDocumento) +
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
 * Dati dell'XML dalla fotografia e dalle righe salvate. `DatiBollo` vale `importoBolloAl` alla
 * data del documento.
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
      bollo: t.bolloDovuto ? { importo: importoBolloAl(t.dataDocumento) } : null,
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
