/**
 * IBAN: normalizzazione e validazione (D3, D21). Controlla forma, lunghezza del paese e
 * cifre di controllo mod-97; non verifica che il conto esista. Il valore non compare mai nei
 * messaggi: l'IBAN di un cliente e' un dato personale/finanziario.
 */

export const MESSAGGIO_IBAN_NON_VALIDO = "L'IBAN non è valido."

const LUNGHEZZE: Readonly<Record<string, number>> = {
  IT: 27,
  SM: 27,
  VA: 22,
  DE: 22,
  FR: 27,
  ES: 24,
  AT: 20,
  CH: 21,
  GB: 22,
}

/** Senza spazi, maiuscolo. */
export function normalizzaIban(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase()
}

export function ibanValido(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  const attesa = LUNGHEZZE[iban.slice(0, 2)]
  if (attesa !== undefined) {
    if (iban.length !== attesa) return false
  } else if (iban.length < 15 || iban.length > 34) {
    return false
  }
  // mod-97 a blocchi: sposta i primi 4 caratteri in coda, lettere -> 10..35
  const riordinato = iban.slice(4) + iban.slice(0, 4)
  let resto = 0
  for (const c of riordinato) {
    const cifre = c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c
    for (const d of cifre) resto = (resto * 10 + Number(d)) % 97
  }
  return resto === 1
}
