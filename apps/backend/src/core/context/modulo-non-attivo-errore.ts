/**
 * Risposta per una rotta di un modulo non attivo sull'azienda selezionata: 403, con
 * `error: 'MODULO_NON_ATTIVO'` e l'elenco dei moduli che avrebbero consentito l'accesso
 * (basta uno). Il frontend riconosce il codice, ricarica i moduli e non azzera la selezione.
 */
export const MODULO_NON_ATTIVO = 'MODULO_NON_ATTIVO'

export function rispostaModuloNonAttivo(moduli: readonly string[]) {
  return {
    message: "Il modulo non è attivo per l'azienda selezionata.",
    error: MODULO_NON_ATTIVO,
    details: { moduli: [...moduli] },
  }
}
