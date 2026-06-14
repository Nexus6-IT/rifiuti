/**
 * Helper di formattazione per il tracciato MUD.
 *
 * Il file MUD richiede ASCII Standard (ISO 646): niente UNICODE né set esteso.
 * Le vocali accentate vanno sostituite con "vocale + apice" (À → A', È → E', …)
 * e il testo è in MAIUSCOLO. I campi sono separati da `;` (anche l'ultimo).
 */

const ACCENT_MAP: Record<string, string> = {
  à: "A'", á: "A'", è: "E'", é: "E'", ì: "I'", í: "I'", ò: "O'", ó: "O'", ù: "U'", ú: "U'",
  À: "A'", Á: "A'", È: "E'", É: "E'", Ì: "I'", Í: "I'", Ò: "O'", Ó: "O'", Ù: "U'", Ú: "U'",
}

/** Converte una stringa in ASCII MUD (accenti → vocale+apice, maiuscolo, no set esteso). */
export function toMudAscii(input: string | null | undefined): string {
  if (!input) return ''
  let s = input.replace(/[àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ]/g, (c) => ACCENT_MAP[c] ?? c)
  s = s.toUpperCase()
  // Rimuove eventuali caratteri residui fuori dall'ASCII stampabile.
  s = s.replace(/[^\x20-\x7E]/g, '')
  return s
}

/** Quantità in kg, intero, allineato come numero (il MUD non usa decimali nei kg). */
export function mudKg(value: number): string {
  return String(Math.round(value || 0))
}

/**
 * Costruisce un record: `TIPO;campo1;campo2;...;campoN;`.
 * Ogni campo è seguito da `;` (incluso l'ultimo), come da specifica.
 */
export function mudRecord(type: string, fields: Array<string | number>): string {
  const parts = fields.map((f) => (typeof f === 'number' ? String(f) : toMudAscii(f)))
  return `${type};${parts.join(';')};`
}
