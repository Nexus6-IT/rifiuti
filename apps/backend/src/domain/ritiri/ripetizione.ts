import { MAX_OCCORRENZE_RIPETIZIONE } from './tipi'
import { giornoValido } from './validazione'

export interface Ripetizione {
  /** Passo in giorni (ogniGiorni) o in settimane (ogniSettimane); esattamente uno dei due. */
  ogniGiorni?: number
  ogniSettimane?: number
  /** Ultimo giorno incluso, 'AAAA-MM-GG'. */
  fino: string
}

export type CodiceErroreRipetizione =
  | 'DATA_NON_VALIDA'
  | 'PASSO_NON_VALIDO'
  | 'FINO_PRIMA_DELLA_DATA'
  | 'FINO_OLTRE_UN_ANNO'
  | 'TROPPE_OCCORRENZE'

export type EsitoEspansione =
  | { ok: true; date: string[] }
  | { ok: false; codice: CodiceErroreRipetizione }

const GIORNO_MS = 24 * 60 * 60 * 1000

function aTimestamp(giorno: string): number {
  const [a, m, g] = giorno.split('-').map(Number)
  return Date.UTC(a, m - 1, g)
}

function daTimestamp(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** Stesso giorno dell'anno dopo (29/02 → 28/02), 'AAAA-MM-GG'. */
function unAnnoDopo(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number)
  const d = new Date(Date.UTC(a + 1, m - 1, g))
  // 29 febbraio + 1 anno trabocca su marzo: si torna a fine febbraio
  if (d.getUTCMonth() !== m - 1) return daTimestamp(Date.UTC(a + 1, m, 0))
  return daTimestamp(d.getTime())
}

/**
 * Espande una ripetizione in date. Le date sono giorni di calendario (stringhe), quindi il
 * cambio dell'ora legale non le sposta mai: l'aritmetica è fatta in UTC a mezzanotte e
 * restituita come 'AAAA-MM-GG'. La prima occorrenza è `dataPrevista` stessa.
 *
 * Mai troncamenti silenziosi: più di 52 occorrenze o una scadenza oltre un anno dalla data
 * di partenza sono errori (D2).
 */
export function espandiRipetizione(
  dataPrevista: string,
  ripetizione: Ripetizione
): EsitoEspansione {
  if (!giornoValido(dataPrevista) || !giornoValido(ripetizione.fino)) {
    return { ok: false, codice: 'DATA_NON_VALIDA' }
  }
  const { ogniGiorni, ogniSettimane } = ripetizione
  if ((ogniGiorni == null) === (ogniSettimane == null)) {
    return { ok: false, codice: 'PASSO_NON_VALIDO' }
  }
  const passo = ogniGiorni ?? (ogniSettimane as number) * 7
  if (!Number.isInteger(passo) || passo <= 0) return { ok: false, codice: 'PASSO_NON_VALIDO' }

  if (ripetizione.fino < dataPrevista) return { ok: false, codice: 'FINO_PRIMA_DELLA_DATA' }
  if (ripetizione.fino > unAnnoDopo(dataPrevista))
    return { ok: false, codice: 'FINO_OLTRE_UN_ANNO' }

  const date: string[] = []
  const fine = aTimestamp(ripetizione.fino)
  for (let ts = aTimestamp(dataPrevista); ts <= fine; ts += passo * GIORNO_MS) {
    if (date.length === MAX_OCCORRENZE_RIPETIZIONE)
      return { ok: false, codice: 'TROPPE_OCCORRENZE' }
    date.push(daTimestamp(ts))
  }
  return { ok: true, date }
}
