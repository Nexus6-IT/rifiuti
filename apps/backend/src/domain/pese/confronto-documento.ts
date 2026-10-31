import { convertiInKg, normalizzaUnitaRegistro } from '../waste-movement/unita-misura-registro'

export interface ConfrontoDocumento {
  confrontabile: boolean
  quantitaKg: number | null
  differenzaKg: number | null
}

/**
 * Confronto fra il netto della pesa e la quantità di un documento (movimento, FIR).
 * Nessuna tolleranza: ogni differenza diversa da zero si mostra.
 * `differenzaKg` = netto − quantità del documento, in kg (arrotondata al grammo).
 */
export function confrontaConDocumento(
  nettoKg: number | null,
  quantita: number,
  unita: string
): ConfrontoDocumento {
  const quantitaKg = Number.isFinite(quantita) ? convertiInKg(quantita, unita) : null
  if (nettoKg === null || quantitaKg === null) {
    return { confrontabile: false, quantitaKg: null, differenzaKg: null }
  }
  const differenzaKg = Math.round((nettoKg - quantitaKg) * 1000) / 1000
  return { confrontabile: true, quantitaKg, differenzaKg }
}

/**
 * Netto espresso nell'unità del FIR: kg invariato, tonnellate a 2 decimali (come la colonna
 * `effective_weight` Decimal(10,2): 3 decimali non si potrebbero salvare), altro null.
 * L'arrotondamento è al centesimo di tonnellata (10 kg) più vicino, metà verso l'alto; un netto
 * che arrotonda a 0 (meno di 5 kg) NON è convertibile in silenzio: chi chiama deve rifiutarlo
 * (`PESO_FIR_MINIMO`).
 */
export function nettoNellUnitaFir(nettoKg: number, unita: string): number | null {
  const u = normalizzaUnitaRegistro(unita)
  if (u.unita === 'KG') return nettoKg
  if (u.unita === 'T') return Math.round(nettoKg / 10) / 100
  return null
}

/** Peso minimo registrabile nel FIR (colonna Decimal(10,2), DTO `@Min(0.01)`). */
export const PESO_FIR_MINIMO = 0.01
