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

/** Netto espresso nell'unità del FIR: kg invariato, tonnellate a 2 decimali, altro null. */
export function nettoNellUnitaFir(nettoKg: number, unita: string): number | null {
  const u = normalizzaUnitaRegistro(unita)
  if (u.unita === 'KG') return nettoKg
  if (u.unita === 'T') return Math.round(nettoKg / 10) / 100
  return null
}
