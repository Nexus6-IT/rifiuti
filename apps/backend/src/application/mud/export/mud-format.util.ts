/**
 * Helper di formattazione per il tracciato MUD.
 *
 * Il file MUD richiede ASCII Standard (ISO 646): niente UNICODE né set esteso.
 * Le vocali accentate vanno sostituite con "vocale + apice" (À → A', È → E', …)
 * e il testo è in MAIUSCOLO. I campi sono separati da `;` (anche l'ultimo).
 */

const ACCENT_MAP: Record<string, string> = {
  à: "A'",
  á: "A'",
  è: "E'",
  é: "E'",
  ì: "I'",
  í: "I'",
  ò: "O'",
  ó: "O'",
  ù: "U'",
  ú: "U'",
  À: "A'",
  Á: "A'",
  È: "E'",
  É: "E'",
  Ì: "I'",
  Í: "I'",
  Ò: "O'",
  Ó: "O'",
  Ù: "U'",
  Ú: "U'",
}

/** Converte una stringa in ASCII MUD (accenti → vocale+apice, maiuscolo, no set esteso). */
export function toMudAscii(input: string | null | undefined): string {
  if (!input) return ''
  let s = input.replace(/[àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ]/g, c => ACCENT_MAP[c] ?? c)
  s = s.toUpperCase()
  // Rimuove eventuali caratteri residui fuori dall'ASCII stampabile.
  s = s.replace(/[^\x20-\x7E]/g, '')
  // Il `;` è il separatore di campo: non può comparire dentro un valore.
  s = s.replace(/;/g, ' ')
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
  const parts = fields.map(f => (typeof f === 'number' ? String(f) : toMudAscii(f)))
  return `${type};${parts.join(';')};`
}

/** Intero zero-paddato a `width` cifre (campi "num" a lunghezza fissa). */
export function mudNum(value: number, width: number): string {
  return String(Math.max(0, Math.round(value || 0))).padStart(width, '0')
}

/**
 * Quantità nel formato "7 int 3 dec" → `0000000,000` (11 caratteri):
 * 7 cifre intere zero-paddate, virgola decimale, 3 decimali.
 */
export function mudQty(value: number): string {
  const v = Math.max(0, value || 0)
  let intPart = Math.floor(v)
  let dec = Math.round((v - intPart) * 1000)
  if (dec >= 1000) {
    intPart += 1
    dec -= 1000
  }
  return `${String(intPart).padStart(7, '0')},${String(dec).padStart(3, '0')}`
}

/** Campo alfanumerico left-aligned, spazio-paddato/troncato a `width`. */
export function mudAlfa(value: string | null | undefined, width: number): string {
  return toMudAscii(value).slice(0, width).padEnd(width, ' ')
}

/** Codice fiscale (16): P.IVA 11 cifre left-aligned + 5 spazi (regola tracciato). */
export function mudCodiceFiscale(cf: string): string {
  return mudAlfa(cf, 16)
}

/** Unità di misura MUD: kg=1, t=2 (default kg). */
export const MUD_UM_KG = 1

/** Data in formato MUD "AAAAMMGG". */
export function mudDate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, '0')
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}${m}${day}`
}

/** Ora in formato MUD "HHMMSS". */
export function mudTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0')
  const mi = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}${mi}${s}`
}
