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

function validaBloccoRegione(
  etichetta: string,
  codreg: string | undefined,
  blocco: BloccoErroreCobat,
  out: ErroreRecordCobat[]
): void {
  if (!/^[A-Z]$/.test(codreg ?? '')) {
    out.push({
      messaggio: `Regione di ${etichetta} non trovata: senza regione il record non e valido`,
      origine: 'ANAGRAFICA',
      blocco,
      campo: `regione ${etichetta}`,
    })
  }
}

/** Blocco del record a cui appartiene un errore (serve a trovare l'anagrafica da correggere). */
export type BloccoErroreCobat = 'produttore' | 'trasportatore' | 'smaltitore' | 'intermediario'

/**
 * Errore bloccante di un record con il punto in cui si corregge: `MOVIMENTO` (dato del movimento),
 * `ANAGRAFICA` (dato del soggetto del `blocco`), `CAMPAGNA` (campagna del movimento o predefinita
 * della sede). `carattere` = carattere non rappresentabile in Windows-1252 (`campo` valorizzato).
 */
export interface ErroreRecordCobat {
  messaggio: string
  origine: 'MOVIMENTO' | 'ANAGRAFICA' | 'CAMPAGNA'
  blocco?: BloccoErroreCobat
  campo?: string
  carattere?: boolean
}

/** Errori bloccanti di un record, in forma di testo. */
export function validaRecordCobat(r: RecordCobat): string[] {
  return erroriRecordCobat(r).map(x => x.messaggio)
}

/** Errori bloccanti di un record con il punto di correzione (D14). */
export function erroriRecordCobat(r: RecordCobat): ErroreRecordCobat[] {
  const out: ErroreRecordCobat[] = []
  const e = {
    push: (...m: string[]) =>
      out.push(...m.map(messaggio => ({ messaggio, origine: 'MOVIMENTO' as const }))),
  }
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
  if (!/^[A-Za-z0-9]{2}$/.test(r.campagnaCodice)) {
    out.push({
      messaggio: 'Codice campagna errato (2 caratteri)',
      origine: 'CAMPAGNA',
      campo: 'codice campagna',
    })
  }

  const regioni: Array<[string, string | undefined, BloccoErroreCobat, boolean]> = [
    ['produttore (sede legale)', r.produttore?.sedeLegale.codreg, 'produttore', !!r.produttore],
    ['produttore (unita locale)', r.produttore?.unitaLocale.codreg, 'produttore', !!r.produttore],
    ['trasportatore', r.trasportatore?.sedeLegale.codreg, 'trasportatore', !!r.trasportatore],
    ['smaltitore (sede legale)', r.smaltitore?.sedeLegale.codreg, 'smaltitore', !!r.smaltitore],
    ['smaltitore (unita locale)', r.smaltitore?.unitaLocale.codreg, 'smaltitore', !!r.smaltitore],
    ['intermediario', r.intermediario?.codreg, 'intermediario', !!r.intermediario],
  ]
  for (const [etichetta, codreg, blocco, presente] of regioni) {
    if (presente) validaBloccoRegione(etichetta, codreg, blocco, out)
  }

  // Caratteri non rappresentabili in Windows-1252 (D6): si controllano tutti i testi del record.
  interface Valore {
    campo: string
    valore: string
    origine: ErroreRecordCobat['origine']
    blocco?: BloccoErroreCobat
  }
  const valori: Valore[] = [
    { campo: 'codazi', valore: r.codazi, origine: 'MOVIMENTO' },
    { campo: 'targa', valore: r.targa, origine: 'MOVIMENTO' },
    { campo: 'rimorchio', valore: r.rimorchio, origine: 'MOVIMENTO' },
    { campo: 'bolla', valore: r.bolla, origine: 'MOVIMENTO' },
    { campo: 'autista', valore: r.autista, origine: 'MOVIMENTO' },
    { campo: 'campagna', valore: r.campagnaDescrizione, origine: 'CAMPAGNA' },
  ]
  const legali: Array<[BloccoErroreCobat, BloccoSedeLegaleCobat | undefined]> = [
    ['produttore', r.produttore?.sedeLegale],
    ['trasportatore', r.trasportatore?.sedeLegale],
    ['smaltitore', r.smaltitore?.sedeLegale],
  ]
  for (const [blocco, b] of legali) {
    if (!b) continue
    const o = 'ANAGRAFICA' as const
    valori.push(
      { campo: `descrizione ${blocco}`, valore: b.descrizione, origine: o, blocco },
      { campo: `via ${blocco}`, valore: b.via, origine: o, blocco },
      { campo: `localita ${blocco}`, valore: b.localita, origine: o, blocco },
      {
        campo: `legale rappresentante ${blocco}`,
        valore: `${b.legaleRappresentanteCognome}${b.legaleRappresentanteNome}`,
        origine: o,
        blocco,
      }
    )
  }
  const unita: Array<[BloccoErroreCobat, BloccoUnitaLocaleCobat | undefined]> = [
    ['produttore', r.produttore?.unitaLocale],
    ['smaltitore', r.smaltitore?.unitaLocale],
  ]
  for (const [blocco, b] of unita) {
    if (!b) continue
    valori.push(
      { campo: `via unita locale ${blocco}`, valore: b.via, origine: 'ANAGRAFICA', blocco },
      {
        campo: `localita unita locale ${blocco}`,
        valore: b.localita,
        origine: 'ANAGRAFICA',
        blocco,
      }
    )
  }
  if (r.intermediario) {
    const blocco = 'intermediario' as const
    valori.push(
      {
        campo: 'intermediario',
        valore: r.intermediario.descrizione,
        origine: 'ANAGRAFICA',
        blocco,
      },
      { campo: 'via intermediario', valore: r.intermediario.via, origine: 'ANAGRAFICA', blocco },
      {
        campo: 'localita intermediario',
        valore: r.intermediario.localita,
        origine: 'ANAGRAFICA',
        blocco,
      }
    )
  }
  for (const v of valori) {
    for (const messaggio of caratteriNonRappresentabili(v.valore, v.campo)) {
      out.push({
        messaggio,
        origine: v.origine,
        ...(v.blocco ? { blocco: v.blocco } : {}),
        campo: v.campo,
        carattere: true,
      })
    }
  }
  return out
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
