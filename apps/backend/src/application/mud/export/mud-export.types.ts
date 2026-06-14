/**
 * Tipi per l'export telematico del MUD (formato sequenziale multirecord
 * Unioncamere/Ecocerved). Vedi docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf.
 */

/** Anagrafica del soggetto dichiarante (azienda / unità locale). */
export interface MudAzienda {
  ragioneSociale: string
  partitaIva: string
  codiceFiscale?: string
  via: string
  comune: string
  provincia: string
  cap: string
  pec?: string
  /** Codice attività economica ISTAT (ATECO 2007, 6 cifre). */
  atecoCode?: string
  /** Codice ISTAT del comune (6 cifre), risolto dalle tabelle di riferimento. */
  comuneCode?: string
}

/** Riga rifiuto (Scheda RIF) — quantità per codice CER/EER. */
export interface MudRifiutoLine {
  cerCode: string
  quantitaKg: number
}

/** Dati aggregati per la generazione del file MUD di un anno. */
export interface MudExportData {
  year: number
  azienda: MudAzienda
  rifiuti: MudRifiutoLine[]
}

/** Risultato dell'export: contenuto del file + metadati. */
export interface MudExportResult {
  filename: string
  content: string
  version: string
  year: number
}

/**
 * Generatore del tracciato MUD per una specifica **versione/anno**.
 * Ogni anno di dichiarazione ha la propria implementazione (versionamento):
 * vedi `MudVersionRegistry`.
 */
export interface MudTracciatoVersion {
  /** Costante release del tracciato (es. "6.04/24"). */
  readonly version: string
  /** Anno di dichiarazione coperto (es. 2024). */
  readonly year: number
  /** Produce il contenuto del file telematico dai dati aggregati. */
  generate(data: MudExportData): string
}
