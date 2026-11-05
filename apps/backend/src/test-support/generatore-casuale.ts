/**
 * Generatore pseudo-casuale con seme fisso per i test basati su proprieta' (scelta di piano P3:
 * nessuna dipendenza nuova come `fast-check`). Stesso seme, stessa sequenza: un caso che fallisce
 * si riproduce con i suoi valori. Solo per gli spec.
 */
export interface GeneratoreCasuale {
  /** Prossimo numero in [0, 1). */
  prossimo(): number
  /** Intero in [min, max], estremi inclusi (`max - min` sotto 2^52). */
  intero(min: number, max: number): number
  /** Decimale come stringa: l'intero scalato in [min, max] diviso per 10^decimali, senza `number`. */
  decimale(min: number, max: number, decimali: number): string
  /** Un elemento a caso dell'elenco (non vuoto). */
  scegli<T>(elenco: readonly T[]): T
}

/** Mulberry32: 32 bit di stato, sufficiente per i test. */
export function creaGeneratore(seme: number): GeneratoreCasuale {
  let stato = seme >>> 0
  const prossimo = (): number => {
    stato = (stato + 0x6d2b79f5) >>> 0
    let t = stato
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const intero = (min: number, max: number): number =>
    min + Math.floor(prossimo() * (max - min + 1))
  return {
    prossimo,
    intero,
    decimale(min, max, decimali) {
      const n = String(intero(min, max)).padStart(decimali + 1, '0')
      return decimali === 0 ? n : `${n.slice(0, -decimali)}.${n.slice(-decimali)}`
    },
    scegli<T>(elenco: readonly T[]): T {
      return elenco[intero(0, elenco.length - 1)]
    },
  }
}
