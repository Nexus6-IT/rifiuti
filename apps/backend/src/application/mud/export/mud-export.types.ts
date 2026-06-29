/**
 * Tipi per l'export telematico del MUD (formato sequenziale multirecord
 * Unioncamere/Ecocerved). Vedi docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf.
 */

/** Anagrafica del soggetto dichiarante (azienda / unità locale). */
export interface MudAzienda {
  ragioneSociale: string
  partitaIva: string
  codiceFiscale?: string
  /** Indirizzo sede legale (opzionale per tenant creati via signup self-service). */
  via?: string
  civico?: string
  /** Comune sede legale (opzionale per tenant creati via signup self-service). */
  comune?: string
  /** Provincia (sigla 2 lettere, opzionale per tenant creati via signup self-service). */
  provincia?: string
  /** CAP (5 cifre, opzionale per tenant creati via signup self-service). */
  cap?: string
  pec?: string
  telefono?: string
  /** Codice attività economica ISTAT (ATECO 2007, 6 cifre). */
  atecoCode?: string
  /** Codice ISTAT del comune (6 cifre), risolto dalle tabelle di riferimento. */
  comuneCode?: string
  /** N° iscrizione REA. */
  reaNumber?: string
  /** Totale addetti nell'unità locale. */
  numeroAddetti?: number
  legaleRappresentanteNome?: string
  legaleRappresentanteCognome?: string
}

/** Stato fisico del rifiuto (Scheda RIF). Default: solido non polverulento. */
export type StatoFisico =
  | 'SOLIDO_POLVERULENTO'
  | 'SOLIDO_NON_POLVERULENTO'
  | 'FANGOSO_PALABILE'
  | 'LIQUIDO'
  | 'AERIFORME'
  | 'VISCHIOSO_SCIROPPOSO'
  | 'ALTRO'

/** Modulo DR (BB) — rifiuto conferito a terzi (destinatario). */
export interface MudAllegatoDR {
  codiceFiscale: string
  ragioneSociale: string
  /** Codice ISTAT provincia (3 cifre) — dalla parte iniziale del codice comune. */
  istatProvincia?: string
  /** Codice ISTAT comune (3 cifre) — dalla parte finale del codice comune. */
  istatComune?: string
  indirizzo?: string
  civico?: string
  cap?: string
  quantitaKg: number
}

/** Modulo TE (BB) — rifiuto trasportato da terzi (trasportatore): solo CF + R.S. */
export interface MudAllegatoTE {
  codiceFiscale: string
  ragioneSociale: string
}

/** Riga rifiuto (Scheda RIF) — quantità per codice CER/EER. */
export interface MudRifiutoLine {
  cerCode: string
  /** Rifiuto prodotto nell'unità locale (kg). */
  prodottoKg: number
  /** Quantità complessiva avviata a recupero (kg). */
  recuperoKg: number
  /** Quantità complessiva avviata a smaltimento (kg). */
  smaltimentoKg: number
  /** Stato fisico; default SOLIDO_NON_POLVERULENTO (tipico dei metalli/solidi). */
  statoFisico?: StatoFisico
  /** Moduli BB DR (conferiti a terzi/destinatari). */
  dr?: MudAllegatoDR[]
  /** Moduli BB TE (trasportatori). */
  te?: MudAllegatoTE[]
}

/** Dati aggregati per la generazione del file MUD di un anno. */
export interface MudExportData {
  year: number
  azienda: MudAzienda
  rifiuti: MudRifiutoLine[]
  /** Istante di creazione del file (testata XX); default: ora corrente. */
  generatedAt?: Date
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
