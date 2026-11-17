/** Codici stabili degli errori di costruzione di una chiave legacy. */
export type CodiceChiaveLegacy =
  | 'DITTA_NON_VALIDA'
  | 'ANNO_NON_VALIDO'
  | 'COD_NON_VALIDO'
  | 'TABELLA_NON_AMMESSA'
  | 'FISCALE_NON_VALIDO'
  | 'PRECOD_NON_VALIDO'
  | 'COMPONENTE_NON_VALIDO'

/** Errore tipato del dominio `migrazione`: mai silenziato, mai corretto. */
export class ChiaveLegacyError extends Error {
  constructor(
    public readonly codice: CodiceChiaveLegacy,
    dettaglio: string
  ) {
    super(`${codice}: ${dettaglio}`)
    this.name = 'ChiaveLegacyError'
  }
}
