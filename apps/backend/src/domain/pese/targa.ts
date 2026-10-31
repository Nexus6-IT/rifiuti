const CARATTERI_AMMESSI = /^[A-Za-z0-9\s.-]+$/
const FORMATO_TARGA = /^[A-Z0-9]{2,15}$/

/**
 * Targa in forma canonica: maiuscole, senza spazi, trattini e punti.
 * `null` se il risultato non è di 2-15 caratteri alfanumerici.
 */
export function normalizzaTarga(s: string): string | null {
  // Prima del toUpperCase: 'ß', 'ﬀ' e 'ı' diventerebbero lettere ASCII
  if (!CARATTERI_AMMESSI.test(s)) return null
  const t = s.toUpperCase().replace(/[\s.-]/g, '')
  return FORMATO_TARGA.test(t) ? t : null
}
