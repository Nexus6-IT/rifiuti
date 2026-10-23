/**
 * Risposte per un'azienda selezionata che non si può usare, condivise dal
 * `TenantSwitchInterceptor` (header `X-Tenant-ID`) e dal refresh del token (azienda scelta
 * con lo switch). Il frontend riconosce i due codici.
 */

/**
 * Azienda non accessibile: identica per un'azienda inesistente, una non autorizzata e un
 * identificativo malformato (nessuna enumerazione). Il frontend cancella la selezione.
 */
export const AZIENDA_SELEZIONATA_NON_ACCESSIBILE = {
  message: "L'azienda selezionata non è più accessibile: selezionane un'altra.",
  error: 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE',
} as const

/**
 * Verifica non eseguibile (errore del database): 503 e non 403, perché la selezione può essere
 * validissima e il frontend non deve cancellarla. Si riprova.
 */
export const VERIFICA_AZIENDA_NON_DISPONIBILE = {
  message: "Verifica dell'azienda selezionata non disponibile, riprova.",
  error: 'VERIFICA_AZIENDA_NON_DISPONIBILE',
} as const
