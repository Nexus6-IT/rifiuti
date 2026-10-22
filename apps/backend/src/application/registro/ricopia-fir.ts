import { Prisma } from '@prisma/client'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import { chiaveConfrontoCer } from '../../domain/waste-movement/cer-registro'

/**
 * Ricopia di un FIR nel registro: confronto fra un movimento già registrato e uno
 * da registrare, per riconoscere un retry (stessi dati) da una seconda ricopia
 * con dati diversi. Modulo condiviso: lo usa anche la ricerca dei doppi storici.
 */
export interface DatiRicopia {
  cerCode: string
  quantity: number | string | Prisma.Decimal
  unit: string | null
  movementDate: Date
}

/**
 * Quantità arrotondata come la salva la colonna `numeric(10,2)` (metà per eccesso).
 * Niente `Math.round(q * 100)`: `1.005 * 100` in virgola mobile vale `100.49999…`.
 */
export function quantitaComeInDatabase(q: number | string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(q).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/** Vero se i due movimenti hanno lo stesso CER (sulle cifre), quantità, unità e data. */
export function stessiDatiRicopia(a: DatiRicopia, b: DatiRicopia): boolean {
  return (
    chiaveConfrontoCer(a.cerCode) === chiaveConfrontoCer(b.cerCode) &&
    quantitaComeInDatabase(a.quantity).equals(quantitaComeInDatabase(b.quantity)) &&
    normalizzaUnitaRegistro(a.unit).unita === normalizzaUnitaRegistro(b.unit).unita &&
    a.movementDate.getTime() === b.movementDate.getTime()
  )
}
