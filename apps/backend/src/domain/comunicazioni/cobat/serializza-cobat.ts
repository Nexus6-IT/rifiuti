import {
  caratteriNonRappresentabili,
  dataAaaammgg,
  decimaleFisso,
  layout,
  spazi,
  testo,
  type CampoLayout,
} from '../fisso/campo-fisso'
import type { TracciatoComunicazione } from '../tracciato-comunicazione'
import {
  ANNO_MINIMO_COBAT,
  CODIFICA_COBAT,
  CONTENT_TYPE_COBAT,
  FINE_RIGA_COBAT,
  LUNGHEZZA_RECORD_COBAT,
  SPAZI_CODA_COBAT_DOPO_2009,
  VERSIONE_COBAT,
} from './costanti'
import type {
  BloccoIntermediarioCobat,
  BloccoSedeLegaleCobat,
  BloccoUnitaLocaleCobat,
  DatiFileCobat,
  RecordCobat,
} from './record-cobat'

/** Testata (offset 1-178), nell'ordine della struct `cob`. */
const TESTATA: CampoLayout[] = [
  { nome: 'dtreg', lunghezza: 8 },
  { nome: 'progdta', lunghezza: 6 },
  { nome: 'codazi', lunghezza: 16 },
  { nome: 'tipmov', lunghezza: 1 },
  { nome: 'targa', lunghezza: 9 },
  { nome: 'targa1', lunghezza: 9 },
  { nome: 'bolla', lunghezza: 20 },
  { nome: 'dtfor', lunghezza: 8 },
  { nome: 'note', lunghezza: 30 },
  { nome: 'causa', lunghezza: 1 },
  { nome: 'autist', lunghezza: 20 },
  { nome: 'dtcon', lunghezza: 8 },
  { nome: 'codcer', lunghezza: 6 },
  { nome: 'pgfcer', lunghezza: 1 },
  { nome: 'parrif', lunghezza: 6 },
  { nome: 'pgf', lunghezza: 1 },
  { nome: 'quam3', lunghezza: 14 },
  { nome: 'quaton', lunghezza: 14 },
]

const SEDE_LEGALE: ReadonlyArray<[string, number]> = [
  ['descr', 60],
  ['codreg', 1],
  ['via', 30],
  ['cap', 5],
  ['codcom', 6],
  ['local', 25],
  ['telef', 12],
  ['fax', 12],
  ['codfis', 16],
  ['numciv', 7],
  ['legrap', 25],
  ['nolegrap', 25],
  ['comune', 1],
  ['partita', 11],
]
const UNITA_LOCALE: ReadonlyArray<[string, number]> = [
  ['codreg', 1],
  ['via', 30],
  ['cap', 5],
  ['codcom', 6],
  ['local', 25],
  ['telef', 12],
  ['fax', 12],
  ['codatt', 6],
  ['titolar', 25],
  ['notitol', 25],
  ['numciv', 7],
  ['codest', 15],
]
const INTERMEDIARIO: ReadonlyArray<[string, number]> = [
  ['descr', 60],
  ['codreg', 1],
  ['via', 30],
  ['cap', 5],
  ['codcom', 6],
  ['local', 25],
  ['telef', 12],
  ['fax', 12],
  ['codfis', 16],
  ['numciv', 7],
  ['partita', 11],
]

const blocco = (prefisso: string, campi: ReadonlyArray<[string, number]>): CampoLayout[] =>
  campi.map(([nome, lunghezza]) => ({ nome: `${prefisso}${nome}`, lunghezza }))

/**
 * Layout completo del record (struct `cob`): testata, poi i blocchi p, x, t, s, y, c. La somma deve
 * essere 1409; `layout()` lancia se non coincide.
 */
export const LAYOUT_COBAT = layout(
  [
    ...TESTATA,
    ...blocco('p', SEDE_LEGALE),
    ...blocco('x', UNITA_LOCALE),
    ...blocco('t', SEDE_LEGALE),
    ...blocco('s', SEDE_LEGALE),
    ...blocco('y', UNITA_LOCALE),
    ...blocco('c', INTERMEDIARIO),
  ],
  LUNGHEZZA_RECORD_COBAT
)

const lung = (nome: string): number => {
  const c = LAYOUT_COBAT.find(x => x.nome === nome)
  if (!c) throw new Error(`Campo COBAT sconosciuto: ${nome}`)
  return c.lunghezza
}
const t = (nome: string, valore: string | null | undefined) => testo(valore, lung(nome))

function sedeLegale(p: string, b: BloccoSedeLegaleCobat | null | undefined): string {
  if (!b) return spazi(blocco(p, SEDE_LEGALE).reduce((s, c) => s + c.lunghezza, 0))
  return [
    t(`${p}descr`, b.descrizione),
    t(`${p}codreg`, b.codreg),
    t(`${p}via`, b.via),
    t(`${p}cap`, b.cap),
    t(`${p}codcom`, b.codcom),
    t(`${p}local`, b.localita),
    t(`${p}telef`, b.telefono),
    t(`${p}fax`, b.fax),
    t(`${p}codfis`, b.codiceFiscale),
    t(`${p}numciv`, b.civico),
    t(`${p}legrap`, b.legaleRappresentanteCognome),
    t(`${p}nolegrap`, b.legaleRappresentanteNome),
    t(`${p}comune`, b.comune),
    t(`${p}partita`, b.partitaIva),
  ].join('')
}

function unitaLocale(p: string, b: BloccoUnitaLocaleCobat | null | undefined): string {
  if (!b) return spazi(blocco(p, UNITA_LOCALE).reduce((s, c) => s + c.lunghezza, 0))
  return [
    t(`${p}codreg`, b.codreg),
    t(`${p}via`, b.via),
    t(`${p}cap`, b.cap),
    t(`${p}codcom`, b.codcom),
    t(`${p}local`, b.localita),
    t(`${p}telef`, b.telefono),
    t(`${p}fax`, b.fax),
    t(`${p}codatt`, b.codiceAttivita),
    // titolare, nome del titolare e codice estero: sempre spazi in WinWaste.
    spazi(lung(`${p}titolar`)),
    spazi(lung(`${p}notitol`)),
    t(`${p}numciv`, b.civico),
    spazi(lung(`${p}codest`)),
  ].join('')
}

function intermediario(b: BloccoIntermediarioCobat | null | undefined): string {
  if (!b) return spazi(blocco('c', INTERMEDIARIO).reduce((s, c) => s + c.lunghezza, 0))
  return [
    t('cdescr', b.descrizione),
    t('ccodreg', b.codreg),
    t('cvia', b.via),
    t('ccap', b.cap),
    t('ccodcom', b.codcom),
    t('clocal', b.localita),
    t('ctelef', b.telefono),
    t('cfax', b.fax),
    t('ccodfis', b.codiceFiscale),
    t('cnumciv', b.civico),
    t('cpartita', b.partitaIva),
  ].join('')
}

/** Record fisso di 1409 caratteri (senza coda). */
export function serializzaRecordCobat(r: RecordCobat): string {
  const testata = [
    dataAaaammgg(r.dataRegistrazione),
    t('progdta', r.progressivo),
    t('codazi', r.codazi),
    t('tipmov', r.tipoMovimento === null ? '' : String(r.tipoMovimento)),
    t('targa', r.targa),
    t('targa1', r.rimorchio),
    t('bolla', r.bolla),
    dataAaaammgg(r.dataFormulario),
    spazi(lung('note')),
    t('causa', r.causa === null ? '' : String(r.causa)),
    t('autist', r.autista),
    dataAaaammgg(r.dataConferimento),
    t('codcer', r.cer),
    t('pgfcer', r.pgf),
    spazi(lung('parrif')),
    t('pgf', r.pgf),
    decimaleFisso(r.quam3, 7, lung('quam3')),
    decimaleFisso(r.quaton, 7, lung('quaton')),
  ].join('')
  return (
    testata +
    sedeLegale('p', r.produttore?.sedeLegale) +
    unitaLocale('x', r.produttore?.unitaLocale) +
    sedeLegale('t', r.trasportatore?.sedeLegale) +
    sedeLegale('s', r.smaltitore?.sedeLegale) +
    unitaLocale('y', r.smaltitore?.unitaLocale) +
    intermediario(r.intermediario)
  )
}

/**
 * Coda di controllo (anni > 2009): 185 spazi + codice campagna e descrizione su 32 caratteri +
 * CRLF = 219. Il codice campagna e' di 2 caratteri, la descrizione di 30.
 */
export function codaCobat(r: Pick<RecordCobat, 'campagnaCodice' | 'campagnaDescrizione'>): string {
  const campagna = testo(r.campagnaCodice, 2) + testo(r.campagnaDescrizione, 30)
  return spazi(SPAZI_CODA_COBAT_DOPO_2009) + campagna + FINE_RIGA_COBAT
}

const nonVuoto = (v: string | null | undefined) => (v ?? '').trim() !== ''

function validaBloccoRegione(etichetta: string, codreg: string | undefined, e: string[]): void {
  if (!/^[A-Z]$/.test(codreg ?? '')) {
    e.push(`Regione di ${etichetta} non trovata: senza regione il record non e valido`)
  }
}

/** Errori bloccanti di un record. */
export function validaRecordCobat(r: RecordCobat): string[] {
  const e: string[] = []
  const anno = Number(r.dataRegistrazione.slice(0, 4))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dataRegistrazione)) e.push('Data di registrazione non valida')
  else if (anno < ANNO_MINIMO_COBAT) {
    e.push(`Anno ${anno} non supportato: il tracciato COBAT parte dal ${ANNO_MINIMO_COBAT}`)
  }
  if (!/^\d{6}$/.test(r.progressivo)) e.push('Progressivo non valido (6 cifre)')
  if (!nonVuoto(r.codazi)) e.push('Manca il codice del soggetto esterno (codazi)')
  if (r.tipoMovimento === null || !(r.tipoMovimento >= 1 && r.tipoMovimento <= 7)) {
    e.push('Tipo di movimento non determinabile: indicarlo sul movimento')
  }
  if (r.dataFormulario !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(r.dataFormulario)) {
    e.push('Data del formulario non valida')
  }
  if (r.dataConferimento !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(r.dataConferimento)) {
    e.push('Data di conferimento non valida')
  }
  if (!/^\d{6}$/.test(r.cer)) e.push('CER errato (servono 6 cifre)')
  if (r.pgf !== '' && !/^[A-E]$/.test(r.pgf)) e.push('PGF errato (A-E)')
  if (r.causa !== null && !(r.causa >= 1 && r.causa <= 5)) e.push('Causale errata (1-5)')
  if (!Number.isFinite(r.quaton) || r.quaton < 0 || r.quaton >= 1e6)
    e.push('Quantita in tonnellate errata')
  if (!Number.isFinite(r.quam3) || r.quam3 < 0 || r.quam3 >= 1e6)
    e.push('Quantita in metri cubi errata')
  if (!/^[A-Za-z0-9]{2}$/.test(r.campagnaCodice)) e.push('Codice campagna errato (2 caratteri)')

  const regioni: Array<[string, string | undefined]> = [
    ['produttore (sede legale)', r.produttore?.sedeLegale.codreg],
    ['produttore (unita locale)', r.produttore?.unitaLocale.codreg],
    ['trasportatore', r.trasportatore?.sedeLegale.codreg],
    ['smaltitore (sede legale)', r.smaltitore?.sedeLegale.codreg],
    ['smaltitore (unita locale)', r.smaltitore?.unitaLocale.codreg],
    ['intermediario', r.intermediario?.codreg],
  ]
  const presenti = [
    r.produttore,
    r.produttore,
    r.trasportatore,
    r.smaltitore,
    r.smaltitore,
    r.intermediario,
  ]
  regioni.forEach(([etichetta, codreg], i) => {
    if (presenti[i]) validaBloccoRegione(etichetta, codreg, e)
  })

  // Caratteri non rappresentabili in Windows-1252 (D6): si controllano tutti i testi del record.
  const valori: Array<[string, string]> = [
    ['codazi', r.codazi],
    ['targa', r.targa],
    ['rimorchio', r.rimorchio],
    ['bolla', r.bolla],
    ['autista', r.autista],
    ['campagna', r.campagnaDescrizione],
  ]
  for (const b of [
    r.produttore?.sedeLegale,
    r.trasportatore?.sedeLegale,
    r.smaltitore?.sedeLegale,
  ]) {
    if (!b) continue
    valori.push(
      ['descrizione', b.descrizione],
      ['via', b.via],
      ['localita', b.localita],
      ['legale rappresentante', `${b.legaleRappresentanteCognome}${b.legaleRappresentanteNome}`]
    )
  }
  for (const b of [r.produttore?.unitaLocale, r.smaltitore?.unitaLocale]) {
    if (b) valori.push(['via unita locale', b.via], ['localita unita locale', b.localita])
  }
  if (r.intermediario) {
    valori.push(
      ['intermediario', r.intermediario.descrizione],
      ['via intermediario', r.intermediario.via],
      ['localita intermediario', r.intermediario.localita]
    )
  }
  for (const [etichetta, v] of valori) e.push(...caratteriNonRappresentabili(v, etichetta))
  return e
}

/**
 * Tracciato COBAT ricavato da WinWaste (D7): record fisso da 1409 caratteri seguito da una coda di
 * 219 (185 spazi + campagna 2 + descrizione 30 + CRLF), nessun separatore fra record.
 * Differenza voluta da WinWaste: il blocco trasportatore porta cognome e nome del legale
 * rappresentante, non la descrizione e l'ISTAT dell'unita' locale (ComuCou:2388-2389, difetto).
 */
export const TracciatoCobat: TracciatoComunicazione<DatiFileCobat> = {
  consorzio: 'COBAT',
  versione: VERSIONE_COBAT,
  estensione: 'txt',
  contentType: CONTENT_TYPE_COBAT,
  codifica: CODIFICA_COBAT,
  affidabilita: 'RICAVATO_WINWASTE',
  notaAffidabilita:
    'Tracciato ricavato da WinWaste, da confermare con un file reale accettato dal COBAT.',
  validaDati(dati) {
    const errori: string[] = []
    if (dati.record.length === 0) errori.push('Nessun movimento da comunicare')
    dati.record.forEach((r, i) => {
      for (const m of validaRecordCobat(r)) errori.push(`Record ${i + 1} (${r.riferimento}): ${m}`)
    })
    return errori
  },
  serializza(dati) {
    const errori = this.validaDati(dati)
    if (errori.length > 0)
      throw new Error(`Dati COBAT non validi: ${errori.slice(0, 5).join('; ')}`)
    return dati.record.map(r => serializzaRecordCobat(r) + codaCobat(r)).join('')
  },
}
