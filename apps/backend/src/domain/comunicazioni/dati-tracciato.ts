import { PRODOTTI_CONOU, ProdottoConou } from './conou/prodotti-per-cer'
import {
  EsitoValidazione,
  Oggetto,
  eOggetto,
  enumOpz,
  interoOpz,
  booleanoOpz,
  oggettoOpz,
  rifiutaSconosciuti,
  senzaUndefined,
  stringaOpz,
} from './validazione'

/**
 * Dati del tracciato per movimento (tabella `dati_tracciato_movimento`, D2). Ogni tracciato ha il
 * suo schema, `strict` (campi sconosciuti rifiutati) e la sua `versioneSchema`.
 */

export type TracciatoDati = 'CONOU' | 'COBAT' | 'ORR'
export const TRACCIATI_DATI: readonly TracciatoDati[] = ['CONOU', 'COBAT', 'ORR']

/** Versione corrente dello schema dei dati di ciascun tracciato (colonna `versione_schema`). */
export const VERSIONE_SCHEMA_DATI: Readonly<Record<TracciatoDati, number>> = {
  CONOU: 1,
  COBAT: 1,
  ORR: 1,
}

export const CAUSALI_CONOU = ['B', 'E', 'U', 'M', 'D', 'L'] as const
export type CausaleConou = (typeof CAUSALI_CONOU)[number]

export interface DatiConou {
  prodotto?: ProdottoConou
  /** Percentuale di olio, 0 < p <= 99.99, al massimo due decimali. */
  percentualeOlio?: number
  causale?: CausaleConou
  /** true = scarico interno: la quantita' si scrive negativa (D11). */
  scaricoInterno?: boolean
  formulario?: { serie: string; numero: string; anno: string }
  /** Solo con causale `B` (bonifica): comune di raccolta che sostituisce il detentore. */
  comuneRaccolta?: { istat: string; indirizzo: string; civico?: string }
}

export interface DatiCobat {
  tipoMovimento?: number
  causa?: number
  pgf?: 'A' | 'B' | 'C' | 'D' | 'E'
  campagna?: { codice: string; descrizione: string }
}

export interface DatiOrr {
  attivita?: 'FRA' | 'ROT' | 'AUT'
  /** Per i movimenti senza FIR: numero (15) e data del formulario. */
  formulario?: { numero: string; data: string }
}

export type DatiPerTracciato = {
  CONOU: DatiConou
  COBAT: DatiCobat
  ORR: DatiOrr
}

/** 0 < p <= 99.99 con al massimo due decimali (nessun errore di virgola mobile: si ragiona in centesimi). */
export function percentualeOlioValida(p: number): boolean {
  if (!Number.isFinite(p) || p <= 0 || p > 99.99) return false
  return Math.abs(p * 100 - Math.round(p * 100)) < 1e-9
}

function giornoValido(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

function validaConou(o: Oggetto, errori: string[]): DatiConou {
  rifiutaSconosciuti(
    o,
    ['prodotto', 'percentualeOlio', 'causale', 'scaricoInterno', 'formulario', 'comuneRaccolta'],
    '',
    errori
  )
  const prodotto = enumOpz(o, 'prodotto', '', errori, PRODOTTI_CONOU)
  let percentualeOlio: number | undefined
  if (o.percentualeOlio !== undefined) {
    if (typeof o.percentualeOlio === 'number' && percentualeOlioValida(o.percentualeOlio)) {
      percentualeOlio = o.percentualeOlio
    } else {
      errori.push('percentualeOlio: numero maggiore di 0 e al massimo 99.99, con due decimali')
    }
  }
  const causale = enumOpz(o, 'causale', '', errori, CAUSALI_CONOU)
  const scaricoInterno = booleanoOpz(o, 'scaricoInterno', '', errori)

  let formulario: DatiConou['formulario']
  const f = oggettoOpz(o, 'formulario', '', errori)
  if (f) {
    rifiutaSconosciuti(f, ['serie', 'numero', 'anno'], 'formulario.', errori)
    const serie = stringaOpz(
      f,
      'serie',
      'formulario.',
      errori,
      s => /^[A-Za-z]{0,6}$/.test(s),
      'fino a 6 lettere'
    )
    const numero = stringaOpz(
      f,
      'numero',
      'formulario.',
      errori,
      s => /^[A-Za-z0-9]{1,10}$/.test(s),
      'da 1 a 10 caratteri alfanumerici'
    )
    const anno = stringaOpz(
      f,
      'anno',
      'formulario.',
      errori,
      s => /^(20[2-9][0-9])$/.test(s),
      'anno a 4 cifre, 2020-2099'
    )
    if (serie === undefined || numero === undefined || anno === undefined) {
      if (f.serie === undefined) errori.push('formulario.serie: obbligatorio (anche vuoto)')
      if (f.numero === undefined) errori.push('formulario.numero: obbligatorio')
      if (f.anno === undefined) errori.push('formulario.anno: obbligatorio')
    } else {
      formulario = { serie, numero, anno }
    }
  }

  let comuneRaccolta: DatiConou['comuneRaccolta']
  const c = oggettoOpz(o, 'comuneRaccolta', '', errori)
  if (c) {
    rifiutaSconosciuti(c, ['istat', 'indirizzo', 'civico'], 'comuneRaccolta.', errori)
    const istat = stringaOpz(
      c,
      'istat',
      'comuneRaccolta.',
      errori,
      s => /^[0-9]{6}$/.test(s),
      'codice ISTAT a 6 cifre'
    )
    const indirizzo = stringaOpz(
      c,
      'indirizzo',
      'comuneRaccolta.',
      errori,
      s => s.trim().length > 0 && s.length <= 40,
      'da 1 a 40 caratteri'
    )
    const civico = stringaOpz(
      c,
      'civico',
      'comuneRaccolta.',
      errori,
      s => s.length <= 7,
      'al massimo 7 caratteri'
    )
    if (c.istat === undefined) errori.push('comuneRaccolta.istat: obbligatorio')
    if (c.indirizzo === undefined) errori.push('comuneRaccolta.indirizzo: obbligatorio')
    if (istat !== undefined && indirizzo !== undefined)
      comuneRaccolta = senzaUndefined({ istat, indirizzo, civico })
    if (causale !== 'B') errori.push('comuneRaccolta: ammesso solo con causale B (bonifica)')
  }

  return senzaUndefined({
    prodotto,
    percentualeOlio,
    causale,
    scaricoInterno,
    formulario,
    comuneRaccolta,
  })
}

function validaCobat(o: Oggetto, errori: string[]): DatiCobat {
  rifiutaSconosciuti(o, ['tipoMovimento', 'causa', 'pgf', 'campagna'], '', errori)
  const tipoMovimento = interoOpz(o, 'tipoMovimento', '', errori, 1, 7)
  const causa = interoOpz(o, 'causa', '', errori, 1, 5)
  const pgf = enumOpz(o, 'pgf', '', errori, ['A', 'B', 'C', 'D', 'E'] as const)
  let campagna: DatiCobat['campagna']
  const c = oggettoOpz(o, 'campagna', '', errori)
  if (c) {
    rifiutaSconosciuti(c, ['codice', 'descrizione'], 'campagna.', errori)
    const codice = stringaOpz(
      c,
      'codice',
      'campagna.',
      errori,
      s => /^[A-Za-z0-9]{2}$/.test(s),
      'esattamente 2 caratteri alfanumerici'
    )
    const descrizione = stringaOpz(
      c,
      'descrizione',
      'campagna.',
      errori,
      s => s.length <= 30,
      'al massimo 30 caratteri'
    )
    if (c.codice === undefined) errori.push('campagna.codice: obbligatorio')
    if (c.descrizione === undefined) errori.push('campagna.descrizione: obbligatorio (anche vuoto)')
    if (codice !== undefined && descrizione !== undefined) campagna = { codice, descrizione }
  }
  return senzaUndefined({ tipoMovimento, causa, pgf, campagna })
}

function validaOrr(o: Oggetto, errori: string[]): DatiOrr {
  rifiutaSconosciuti(o, ['attivita', 'formulario'], '', errori)
  const attivita = enumOpz(o, 'attivita', '', errori, ['FRA', 'ROT', 'AUT'] as const)
  let formulario: DatiOrr['formulario']
  const f = oggettoOpz(o, 'formulario', '', errori)
  if (f) {
    rifiutaSconosciuti(f, ['numero', 'data'], 'formulario.', errori)
    const numero = stringaOpz(
      f,
      'numero',
      'formulario.',
      errori,
      s => s.trim().length > 0 && s.length <= 15,
      'da 1 a 15 caratteri'
    )
    const data = stringaOpz(f, 'data', 'formulario.', errori, giornoValido, 'giorno AAAA-MM-GG')
    if (f.numero === undefined) errori.push('formulario.numero: obbligatorio')
    if (f.data === undefined) errori.push('formulario.data: obbligatorio')
    if (numero !== undefined && data !== undefined) formulario = { numero, data }
  }
  return senzaUndefined({ attivita, formulario })
}

/** Valida i dati di un tracciato; restituisce l'oggetto pulito o la lista degli errori. */
export function validaDatiTracciato<T extends TracciatoDati>(
  tracciato: T,
  dati: unknown
): EsitoValidazione<DatiPerTracciato[T]> {
  if (!eOggetto(dati)) return { ok: false, errori: ['i dati devono essere un oggetto'] }
  const errori: string[] = []
  let valore: unknown
  switch (tracciato) {
    case 'CONOU':
      valore = validaConou(dati, errori)
      break
    case 'COBAT':
      valore = validaCobat(dati, errori)
      break
    case 'ORR':
      valore = validaOrr(dati, errori)
      break
    default:
      return { ok: false, errori: [`tracciato sconosciuto: ${String(tracciato)}`] }
  }
  return errori.length > 0
    ? { ok: false, errori }
    : { ok: true, valore: valore as DatiPerTracciato[T] }
}
