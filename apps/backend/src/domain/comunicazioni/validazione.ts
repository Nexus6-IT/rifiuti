/**
 * Piccole primitive di validazione per i dati dei tracciati e le configurazioni (puri, nessuna
 * dipendenza). Ogni validatore accumula gli errori con il percorso del campo e rifiuta i campi
 * sconosciuti (strict). Il piano 4.9c-f parlava di Zod, ma Zod non e' una dipendenza del backend:
 * non se ne aggiunge una solo per questo.
 */

export type EsitoValidazione<T> = { ok: true; valore: T } | { ok: false; errori: string[] }

export type Oggetto = Record<string, unknown>

export function eOggetto(v: unknown): v is Oggetto {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Registra un errore per ogni chiave non ammessa. */
export function rifiutaSconosciuti(
  o: Oggetto,
  ammessi: readonly string[],
  percorso: string,
  errori: string[]
): void {
  for (const k of Object.keys(o)) {
    if (!ammessi.includes(k)) errori.push(`${percorso}${k}: campo sconosciuto`)
  }
}

/** Legge una stringa opzionale con un formato; `undefined` se assente, errore se non valida. */
export function stringaOpz(
  o: Oggetto,
  k: string,
  percorso: string,
  errori: string[],
  verifica: (s: string) => boolean,
  descrizione: string
): string | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !verifica(v)) {
    errori.push(`${percorso}${k}: ${descrizione}`)
    return undefined
  }
  return v
}

export function interoOpz(
  o: Oggetto,
  k: string,
  percorso: string,
  errori: string[],
  min: number,
  max: number
): number | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    errori.push(`${percorso}${k}: intero da ${min} a ${max}`)
    return undefined
  }
  return v
}

export function booleanoOpz(
  o: Oggetto,
  k: string,
  percorso: string,
  errori: string[]
): boolean | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') {
    errori.push(`${percorso}${k}: vero o falso`)
    return undefined
  }
  return v
}

/** Sottooggetto opzionale: `undefined` se assente, errore se non e' un oggetto. */
export function oggettoOpz(
  o: Oggetto,
  k: string,
  percorso: string,
  errori: string[]
): Oggetto | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (!eOggetto(v)) {
    errori.push(`${percorso}${k}: deve essere un oggetto`)
    return undefined
  }
  return v
}

/** Un valore tra quelli ammessi. */
export function enumOpz<T extends string>(
  o: Oggetto,
  k: string,
  percorso: string,
  errori: string[],
  ammessi: readonly T[]
): T | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !(ammessi as readonly string[]).includes(v)) {
    errori.push(`${percorso}${k}: uno tra ${ammessi.join(', ')}`)
    return undefined
  }
  return v as T
}

export const CER_SEI_CIFRE = /^[0-9]{6}$/

/** Rimuove le chiavi con valore `undefined` (per confrontare e salvare oggetti puliti). */
export function senzaUndefined<T extends Oggetto>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
