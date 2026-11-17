import { nonRappresentabili } from './codifica-cp1252'

/**
 * Primitive per i tracciati a larghezza fissa (CONOU, COBAT, O.R.R.). Funzioni pure.
 * Tutte le lunghezze sono in caratteri; con Windows-1252 un carattere = un byte, e un carattere
 * fuori dalla code page è un errore bloccante (`caratteriNonRappresentabili`), mai una sostituzione.
 */

/** Normalizza un testo: NFC, controlli (CR, LF, TAB, ...) → spazio, spazi multipli e bordi ridotti. */
export function normalizzaTesto(valore: string | null | undefined): string {
  if (valore === null || valore === undefined) return ''
  return (
    valore
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim()
  )
}

/** Testo normalizzato, troncato a `lunghezza` caratteri e riempito a destra di spazi. */
export function testo(valore: string | null | undefined, lunghezza: number): string {
  const caratteri = Array.from(normalizzaTesto(valore)).slice(0, lunghezza)
  return caratteri.join('').padEnd(lunghezza, ' ')
}

/** Campo di soli spazi (valore assente). */
export function spazi(lunghezza: number): string {
  return ' '.repeat(lunghezza)
}

function intero(n: number, nome: string): number {
  if (!Number.isInteger(n)) throw new RangeError(`${nome}: serve un intero, ricevuto ${n}`)
  return n
}

/** Intero non negativo con zeri a sinistra. Lancia se non entra o se negativo. */
export function numeroZeri(n: number, lunghezza: number): string {
  intero(n, 'numeroZeri')
  if (n < 0) throw new RangeError(`numeroZeri: valore negativo ${n}`)
  const s = String(n)
  if (s.length > lunghezza)
    throw new RangeError(`numeroZeri: ${n} non entra in ${lunghezza} caratteri`)
  return s.padStart(lunghezza, '0')
}

/**
 * Intero con segno `-` in testa se negativo, scritto a sinistra e riempito a destra di spazi
 * (il `PadRight` di CONOU). Lancia se non entra.
 */
export function numeroSegnato(n: number, lunghezza: number): string {
  intero(n, 'numeroSegnato')
  const s = String(Object.is(n, -0) ? 0 : n)
  if (s.length > lunghezza)
    throw new RangeError(`numeroSegnato: ${n} non entra in ${lunghezza} caratteri`)
  return s.padEnd(lunghezza, ' ')
}

/**
 * Decimale con punto e `decimali` cifre dopo il punto, giustificato a destra su `lunghezza`
 * (COBAT: 7 decimali su 14). Lancia se non entra.
 */
export function decimaleFisso(n: number, decimali: number, lunghezza: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`decimaleFisso: valore non finito ${n}`)
  const s = (Object.is(n, -0) ? 0 : n).toFixed(decimali)
  if (s.length > lunghezza)
    throw new RangeError(`decimaleFisso: ${s} non entra in ${lunghezza} caratteri`)
  return s.padStart(lunghezza, ' ')
}

/** Data `AAAAMMGG` da un giorno `YYYY-MM-DD` (o da un oggetto Date, in UTC). Vuota → 8 spazi. */
export function dataAaaammgg(giorno: string | Date | null | undefined): string {
  if (giorno === null || giorno === undefined || giorno === '') return spazi(8)
  const iso = giorno instanceof Date ? giorno.toISOString().slice(0, 10) : giorno
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new RangeError(`dataAaaammgg: giorno non valido ${JSON.stringify(giorno)}`)
  return `${m[1]}${m[2]}${m[3]}`
}

/** Un campo di un layout: nome, lunghezza e offset (0-based) calcolato dal layout. */
export interface CampoLayout {
  readonly nome: string
  readonly lunghezza: number
}

export interface CampoLayoutPosizionato extends CampoLayout {
  readonly offset: number
}

/**
 * Posiziona i campi uno dopo l'altro e verifica che la somma sia `lunghezzaRecord`.
 * Lancia se non coincide: un layout sbagliato non deve mai produrre record della lunghezza sbagliata.
 */
export function layout(
  campi: readonly CampoLayout[],
  lunghezzaRecord: number
): CampoLayoutPosizionato[] {
  let offset = 0
  const posizionati = campi.map(c => {
    if (!Number.isInteger(c.lunghezza) || c.lunghezza <= 0) {
      throw new RangeError(`layout: lunghezza non valida per ${c.nome}`)
    }
    const p = { ...c, offset }
    offset += c.lunghezza
    return p
  })
  if (offset !== lunghezzaRecord) {
    throw new RangeError(
      `layout: somma ${offset} diversa dalla lunghezza del record ${lunghezzaRecord}`
    )
  }
  return posizionati
}

/** Segnalazioni bloccanti per i caratteri non rappresentabili in Windows-1252 di un valore. */
export function caratteriNonRappresentabili(valore: string, etichetta: string): string[] {
  const nr = nonRappresentabili(normalizzaTesto(valore))
  return nr.length === 0
    ? []
    : [`${etichetta}: carattere non rappresentabile in Windows-1252 (${nr.join(' ')})`]
}
