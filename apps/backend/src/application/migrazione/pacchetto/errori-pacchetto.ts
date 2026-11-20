export type CodiceErrorePacchetto =
  | 'CARTELLA_NON_VALIDA'
  | 'MANIFEST_ASSENTE'
  | 'MANIFEST_NON_VALIDO'
  | 'FORMATO_SCONOSCIUTO'
  | 'FILE_ASSENTE'
  | 'HASH_NON_CORRISPONDE'
  | 'RIGHE_NON_CORRISPONDENTI'
  | 'MAPPA_ASSENTE'
  | 'MAPPA_NON_VALIDA'
  | 'MAPPA_DIVERSA'
  | 'RIGA_NON_VALIDA'

/** Pacchetto o mappa rifiutati prima di qualunque scrittura. Il dettaglio non riporta mai valori. */
export class PacchettoError extends Error {
  constructor(
    readonly codice: CodiceErrorePacchetto,
    readonly dettaglio: string
  ) {
    super(`${codice}: ${dettaglio}`)
    this.name = 'PacchettoError'
  }
}
