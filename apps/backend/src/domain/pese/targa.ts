const FORMATO_TARGA = /^[A-Z0-9]{2,15}$/

/**
 * Targa in forma canonica: maiuscole, senza spazi, trattini e punti.
 * `null` se il risultato non è di 2-15 caratteri alfanumerici.
 */
export function normalizzaTarga(s: string): string | null {
  const t = s.toUpperCase().replace(/[\s.-]/g, '')
  return FORMATO_TARGA.test(t) ? t : null
}
