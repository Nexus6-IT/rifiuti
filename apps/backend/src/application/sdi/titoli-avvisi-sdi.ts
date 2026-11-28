/**
 * Titoli degli avvisi in-app SDI. Sono anche la chiave di deduplica (SQL della sonda): un'unica
 * definizione per chi li scrive (`ElaboraInvioSdiService`, `SondaSdiService`) e per chi li confronta.
 */
export const TITOLO_AVVISO_SDI_INCERTA = 'Invio allo SDI incerto'
export const TITOLO_AVVISO_SDI_SCARTATA = 'Fattura scartata dallo SDI'
export const TITOLO_AVVISO_SDI_ERRORE_INVIO = 'Invio allo SDI non riuscito'
