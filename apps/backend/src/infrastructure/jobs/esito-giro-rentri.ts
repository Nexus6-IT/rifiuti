/** Esito di un giro per tenant: serve al rilancio manuale per distinguere completato e parziale. */
export interface EsitoGiroRentri {
  tenantTotali: number
  tenantConErrore: number
}
