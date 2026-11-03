/**
 * «Fatturazione da» (fase 4.3, decisione 11, spec §4.9): regole pure sulla data di partenza
 * dell'azienda. Dominio puro, nessuna dipendenza.
 */

/** Intervallo di giorni `[da, a)` (`a` escluso; `null` = senza fine) sul quale il filtro cambia. */
export interface IntervalloToccato {
  da: string
  a: string | null
}

/** `AAAA-MM-GG` e giorno realmente esistente nel calendario (vietati 2026-13-40 e 2026-02-30). */
export function dataFatturazioneValida(valore: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valore)
  if (!m) return false
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(anno, mese - 1, giorno))
  return d.getUTCFullYear() === anno && d.getUTCMonth() === mese - 1 && d.getUTCDate() === giorno
}

/**
 * Giorni dei movimenti la cui inclusione cambia passando da `vecchia` a `nuova` (filtro
 * `giorno >= fatturazione_da`; data assente = fatturazione spenta = nessun movimento incluso).
 * - spenta -> data X: entrano tutti i movimenti da X in poi `[X, infinito)`;
 * - data X -> spenta: escono tutti da X in poi `[X, infinito)`;
 * - X -> Y: cambiano solo quelli fra le due date `[min, max)`;
 * - nessun cambio: `null`.
 */
export function movimentiToccati(
  vecchia: string | null,
  nuova: string | null
): IntervalloToccato | null {
  if (vecchia === nuova) return null
  if (vecchia === null) return { da: nuova as string, a: null }
  if (nuova === null) return { da: vecchia, a: null }
  return vecchia < nuova ? { da: vecchia, a: nuova } : { da: nuova, a: vecchia }
}
