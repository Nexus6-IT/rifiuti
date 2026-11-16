/**
 * Esito di un decodificatore dei formati posizionali di WinWaste.
 *
 * Regola D8 del piano Fase 3: nessuna interpretazione silenziosa. Un valore
 * inatteso NON viene corretto: diventa un errore con un codice stabile e un
 * dettaglio che nomina il campo e la regola violata, MAI il valore (i valori
 * possono contenere dati personali e finiscono nei rapporti).
 */
export type Esito<T, C extends string = string> =
  | { readonly ok: true; readonly valore: T }
  | { readonly ok: false; readonly codice: C; readonly dettaglio: string }

export function ok<T>(valore: T): { ok: true; valore: T } {
  return { ok: true, valore }
}

export function errore<C extends string>(
  codice: C,
  dettaglio: string
): { ok: false; codice: C; dettaglio: string } {
  return { ok: false, codice, dettaglio }
}

/** Data di calendario senza fuso orario, formato ISO `AAAA-MM-GG`. */
export type DataIso = string

export function dataValida(anno: number, mese: number, giorno: number): boolean {
  if (anno < 1900 || anno > 2200 || mese < 1 || mese > 12 || giorno < 1) return false
  const bisestile = (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0
  const giorniDelMese = [31, bisestile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return giorno <= giorniDelMese[mese - 1]
}

export function iso(anno: number, mese: number, giorno: number): DataIso {
  const p = (n: number, l: number) => String(n).padStart(l, '0')
  return `${p(anno, 4)}-${p(mese, 2)}-${p(giorno, 2)}`
}
