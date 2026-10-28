import { annoSolareItaliano, giornoItaliano } from '../../core/time/anno-italiano'
import type { PeriodoBilancio } from './bilancio.types'

const ANNO_MINIMO = 2000

/** Unica regola sugli anni ammessi: intero, da 2000 all'anno solare italiano di `oggi`. */
export function annoBilancioValido(anno: number, oggi: Date = new Date()): boolean {
  return Number.isInteger(anno) && anno >= ANNO_MINIMO && anno <= annoSolareItaliano(oggi)
}

/**
 * Periodo del bilancio: dal 1° gennaio a oggi (anno in corso, in giorno italiano) oppure al
 * 31 dicembre (anno chiuso). Lancia RangeError per un anno non ammesso.
 */
export function periodoBilancio(anno: number, oggi: Date): PeriodoBilancio {
  if (!annoBilancioValido(anno, oggi)) throw new RangeError('Anno non valido')
  const annoInCorso = anno === annoSolareItaliano(oggi)
  const al = annoInCorso ? giornoItaliano(oggi) : `${anno}-12-31`
  const meseGiorno = al.slice(5)
  const alAnnoPrecedente = `${anno - 1}-${meseGiorno === '02-29' ? '02-28' : meseGiorno}`
  return {
    anno,
    dal: `${anno}-01-01`,
    al,
    annoInCorso,
    alAnnoPrecedente,
    mesiDelPeriodo: Number(al.slice(5, 7)),
  }
}

/** Variazione relativa rispetto al precedente; null se il precedente non è positivo. */
export function variazione(corrente: number, precedente: number): number | null {
  return precedente > 0 ? (corrente - precedente) / precedente : null
}
