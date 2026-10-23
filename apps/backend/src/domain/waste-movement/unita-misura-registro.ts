/**
 * Unità di misura del registro: unico punto in cui stanno alias e fattori di
 * conversione. Registro, giacenze e MUD lo importano, nessuno li ridefinisce.
 */
export const ALIAS_KG: readonly string[] = ['KG', 'KILOGRAMMI', 'KILOGRAMMO']
export const ALIAS_T: readonly string[] = ['T', 'TON', 'TONNELLATE', 'TONNELLATA']

export interface UnitaNormalizzata {
  /** 'KG' per gli alias dei kg e per l'unità vuota, 'T' per le tonnellate, altrimenti maiuscola */
  unita: string
  massa: boolean
  /** 1, 1000 oppure null per le unità non di massa */
  fattoreKg: number | null
  /** la stringa era vuota, null o undefined (trattata come KG) */
  vuota: boolean
}

export function normalizzaUnitaRegistro(unit: string | null | undefined): UnitaNormalizzata {
  const u = (unit ?? '').trim().toUpperCase()
  if (u === '') return { unita: 'KG', massa: true, fattoreKg: 1, vuota: true }
  if (ALIAS_KG.includes(u)) return { unita: 'KG', massa: true, fattoreKg: 1, vuota: false }
  if (ALIAS_T.includes(u)) return { unita: 'T', massa: true, fattoreKg: 1000, vuota: false }
  return { unita: u, massa: false, fattoreKg: null, vuota: false }
}

/** Quantità in kg (arrotondata al grammo), null per le unità non di massa. */
export function convertiInKg(quantita: number, unit: string | null | undefined): number | null {
  const { fattoreKg } = normalizzaUnitaRegistro(unit)
  if (fattoreKg === null) return null
  return Math.round(quantita * fattoreKg * 1000) / 1000
}

/** Unità da scrivere nei messaggi (mai la stringa grezza del comando). */
export function simboloUnita(u: UnitaNormalizzata): string {
  if (u.unita === 'KG') return 'kg'
  if (u.unita === 'T') return 't'
  return u.unita
}
