/**
 * Elenco degli addebiti di un contratto cliente (4.2b, D8, E1-E3): regole pure, senza database.
 * Le date sono stringhe `YYYY-MM-DD`.
 */

import { dataReale, validaRiferimentiPa } from '../contratti-cliente/regole-contratto-cliente'

export interface DatiElenco {
  codice: string
  descrizione: string
  nota1: string | null
  nota2: string | null
  validoDal: string | null
  validoAl: string | null
  predefinito: boolean
  codiceCig: string | null
  codiceCup: string | null
  idDocumentoPa: string | null
  dataDocumentoPa: string | null
}

const DESCRIZIONE_MAX = 45
const NOTA_MAX = 45
const CODICE = /^[A-Za-z0-9]{1,3}$/

function testo(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

function data(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const t = testo(v)
  if (t === null) return null
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t
}

function codiceElenco(t: string | null): string {
  if (t === null) return ''
  return /^\d{1,3}$/.test(t) ? t.padStart(3, '0') : t.toUpperCase()
}

export function normalizzaElenco(g: Partial<Record<keyof DatiElenco, unknown>>): DatiElenco {
  return {
    // Un codice numerico si riempie a tre cifre ('1' = '001'), come nelle codifiche addebito.
    codice: codiceElenco(testo(g.codice)),
    descrizione: testo(g.descrizione) ?? '',
    nota1: testo(g.nota1),
    nota2: testo(g.nota2),
    validoDal: data(g.validoDal),
    validoAl: data(g.validoAl),
    predefinito: g.predefinito === true,
    codiceCig: testo(g.codiceCig)?.toUpperCase() ?? null,
    codiceCup: testo(g.codiceCup)?.toUpperCase() ?? null,
    idDocumentoPa: testo(g.idDocumentoPa),
    dataDocumentoPa: data(g.dataDocumentoPa),
  }
}

/** Messaggi nell'ordine dei campi (D8); elenco vuoto = dati validi. */
export function validaElenco(d: DatiElenco): string[] {
  const m: string[] = []

  if (!CODICE.test(d.codice)) m.push('Il codice ha da 1 a 3 caratteri alfanumerici.')
  // `000` e' riservato (come nelle codifiche addebito): in WinWaste l'elenco 0 vuol dire
  // "prendi il predefinito".
  else if (d.codice === '000') {
    m.push('Il codice 000 non è ammesso: usa un codice da 001 a 999 o con lettere.')
  }

  if (d.descrizione === '') m.push('Inserisci una descrizione per questo elenco.')
  else if (d.descrizione.length > DESCRIZIONE_MAX) {
    m.push(`La descrizione non può superare ${DESCRIZIONE_MAX} caratteri.`)
  }
  if (d.nota1 !== null && d.nota1.length > NOTA_MAX) {
    m.push(`La nota 1 non può superare ${NOTA_MAX} caratteri.`)
  }
  if (d.nota2 !== null && d.nota2.length > NOTA_MAX) {
    m.push(`La nota 2 non può superare ${NOTA_MAX} caratteri.`)
  }

  if ((d.validoDal === null) !== (d.validoAl === null)) {
    m.push("Indica sia la data di inizio sia quella di fine dell'elenco, oppure nessuna delle due.")
  } else if (d.validoDal !== null && d.validoAl !== null) {
    const dalOk = dataReale(d.validoDal)
    const alOk = dataReale(d.validoAl)
    if (!dalOk) m.push('La data di inizio non è valida.')
    if (!alOk) m.push('La data di fine non è valida.')
    if (dalOk && alOk && d.validoAl < d.validoDal) {
      m.push('La data di fine non può precedere la data di inizio.')
    }
  }

  // Stesse regole e stessi testi del contratto cliente (R33, R58): una sola definizione.
  m.push(...validaRiferimentiPa(d))
  if (d.dataDocumentoPa !== null) {
    if (d.idDocumentoPa === null) {
      m.push('La data del documento della PA si indica solo con il documento.')
    } else if (!dataReale(d.dataDocumentoPa)) {
      m.push('La data del documento della PA non è valida.')
    }
  }

  return m
}

/** Primo numero libero fra `001` e `999`; `null` se sono tutti occupati. */
export function prossimoCodiceElenco(usati: readonly string[]): string | null {
  const occupati = new Set<number>()
  for (const u of usati) if (/^\d{1,3}$/.test(u)) occupati.add(Number(u))
  for (let n = 1; n <= 999; n++) {
    if (!occupati.has(n)) return String(n).padStart(3, '0')
  }
  return null
}

/** "Lista non scaduti": fine vuota o non prima della data. */
export function elenchiValidiAl<T extends { validoAl: string | null }>(
  e: readonly T[],
  data: string
): T[] {
  return e.filter(x => x.validoAl === null || x.validoAl >= data)
}

/** Uno solo valido: quello; altrimenti il predefinito valido; altrimenti nessuno. */
export function elencoProposto<
  T extends { id: string; validoAl: string | null; predefinito: boolean },
>(e: readonly T[], data: string): T | null {
  const validi = elenchiValidiAl(e, data)
  if (validi.length === 1) return validi[0]
  return validi.find(x => x.predefinito) ?? null
}
