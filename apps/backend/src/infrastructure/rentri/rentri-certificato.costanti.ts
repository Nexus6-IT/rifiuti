/**
 * Codice persistito sul FIR (rentriLastSyncErrorCode) quando l'azienda non ha un certificato
 * RENTRI: unica definizione, usata da trasmissione, emissione e riapertura al caricamento del
 * certificato. Sta in un file foglia (niente import) perche' il service delle credenziali non
 * puo' importarlo dal resolver, che a sua volta importa il service (ciclo che rompe la DI).
 * Il resolver lo riesporta accanto a `MESSAGGIO_CERTIFICATO_MANCANTE`.
 */
export const CODICE_CERTIFICATO_MANCANTE = 'RENTRI_CERTIFICATO_MANCANTE'
