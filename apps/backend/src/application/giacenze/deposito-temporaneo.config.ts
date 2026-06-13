/**
 * Soglie per il monitoraggio del **deposito temporaneo** (D.Lgs 152/2006).
 *
 * La norma prevede due criteri alternativi per l'avvio a recupero/smaltimento:
 *  - **temporale**: almeno ogni 3 mesi a prescindere dalle quantità;
 *  - **quantitativo**: al raggiungimento di un volume (es. 30 m³, di cui max
 *    10 m³ di pericolosi).
 *
 * ⚠️ Il limite quantitativo legale è **volumetrico** (m³), mentre qui le
 * quantità sono in kg: la soglia in kg è quindi un **proxy configurabile**, da
 * adattare per operatore/regime. Valori di default indicativi; confermare con il
 * regime scelto dall'operatore prima di trattare gli alert come vincolanti.
 */
export interface DepositoTemporaneoConfig {
  /** Giorni massimi di permanenza in deposito (criterio temporale). */
  maxDurationDays: number
  /** Soglia quantitativa in kg (proxy del limite volumetrico). */
  maxQuantityKg: number
}

export const DEFAULT_DEPOSITO_TEMPORANEO: DepositoTemporaneoConfig = {
  maxDurationDays: 90, // ~3 mesi (criterio temporale)
  maxQuantityKg: 30000, // proxy indicativo del limite volumetrico
}
