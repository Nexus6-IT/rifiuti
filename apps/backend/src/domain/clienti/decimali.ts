/**
 * Importi e percentuali come stringhe decimali a 2 cifre, mai `number` (rapporto 02 §8 p. 5):
 * un double non rappresenta 0,1 e a fine catena di calcoli sbaglia i centesimi.
 *
 * `normalizzaDecimale` accetta la virgola italiana e porta a due decimali; un valore che non e'
 * un numero (o ha piu' di due decimali) torna invariato, cosi' lo rifiuta `decimaleValido`
 * invece di essere "aggiustato" in silenzio.
 */

export function normalizzaDecimale(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const testo = (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '')
    .trim()
    .replace(',', '.')
  if (testo === '') return null
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(testo)
  if (!m) return testo
  return `${m[1]}.${(m[2] ?? '').padEnd(2, '0')}`
}

/** `interi` = numero massimo di cifre intere; al massimo due decimali, nessun segno. */
export function decimaleValido(v: string, interi: number): boolean {
  return new RegExp(`^\\d{1,${interi}}(\\.\\d{1,2})?$`).test(v)
}

/** Confronta due decimali validi senza passare da `number`. */
export function confrontaDecimali(a: string, b: string): -1 | 0 | 1 {
  const [ia, fa = ''] = a.split('.')
  const [ib, fb = ''] = b.split('.')
  const intA = ia.replace(/^0+(?=\d)/, '')
  const intB = ib.replace(/^0+(?=\d)/, '')
  if (intA.length !== intB.length) return intA.length > intB.length ? 1 : -1
  if (intA !== intB) return intA > intB ? 1 : -1
  const lung = Math.max(fa.length, fb.length)
  const decA = fa.padEnd(lung, '0')
  const decB = fb.padEnd(lung, '0')
  if (decA === decB) return 0
  return decA > decB ? 1 : -1
}
