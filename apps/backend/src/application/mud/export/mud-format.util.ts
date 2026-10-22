/**
 * Helper di formattazione per il tracciato MUD.
 *
 * Il file MUD richiede ASCII Standard (ISO 646): niente UNICODE né set esteso.
 * Le vocali accentate vanno sostituite con "vocale + apice" (À → A', È → E', …)
 * e il testo è in MAIUSCOLO. I campi sono separati da `;` (anche l'ultimo).
 */

import { giornoItaliano, orarioItaliano } from '../../../core/time/anno-italiano'

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
export const MUD_UM_KG = 1 as const
export const MUD_UM_T = 2 as const

/**
 * Quantità in kg con la relativa unità di misura. Il campo ha 7 cifre intere:
 * da 10.000.000 kg in su la quantità esce in tonnellate (UM = 2), altrimenti
 * il record sforerebbe la lunghezza fissa e il file verrebbe scartato.
 */
export function mudQtyUm(kg: number): [string, 1 | 2] {
  const v = Math.round(Math.max(0, kg || 0) * 1000) / 1000
  if (v < 10_000_000) return [mudQty(v), MUD_UM_KG]
  const t = Math.round(v) / 1000
  if (t >= 10_000_000) {
    throw new Error(`Quantità di ${kg} kg fuori dal formato del tracciato MUD anche in tonnellate`)
  }
  return [mudQty(t), MUD_UM_T]
}

/**
 * Campo ISTAT a lunghezza fissa (provincia/comune, `num 3` nel tracciato).
 *
 * I codici ISTAT hanno gli zeri a sinistra significativi e il tracciato li
 * tipizza come **numerici**: vanno quindi zero-paddati, non spazio-paddati.
 * Un valore assente diventa `000` ("non dichiarato"), mai tre spazi: un campo
 * `num` riempito di spazi fa scartare il file in fase di acquisizione.
 */
export function mudIstat(value: string | null | undefined, width = 3): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (!digits) return '0'.repeat(width)
  return digits.slice(-width).padStart(width, '0')
}

/**
 * Elenco di operazioni R/D come stringa separata da virgole (campo `alfa 50`
 * del record AU), es. `['R1','R5','R13']` → `"R1,R5,R13"`.
 */
export function mudOperazioni(ops: string[] | undefined, width = 50): string {
  return mudAlfa((ops ?? []).join(','), width)
}

/** Flag booleano MUD: NO=0, SI=1. */
export function mudFlag(value: boolean | undefined): string {
  return value ? '1' : '0'
}

/** Data MUD opzionale: `AAAAMMGG`, oppure 8 zeri se assente. */
export function mudDateOrZero(d: Date | null | undefined): string {
  return d ? mudDate(d) : '00000000'
}

/** Data in formato MUD "AAAAMMGG": il giorno di calendario di Roma, mai quello del server. */
export function mudDate(d: Date): string {
  return giornoItaliano(d).replace(/-/g, '')
}

/** Ora in formato MUD "HHMMSS": l'ora di Roma, mai quella del server. */
export function mudTime(d: Date): string {
  return orarioItaliano(d).replace(/:/g, '')
}
