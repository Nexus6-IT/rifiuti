export interface Indirizzo {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}

export interface Produttore {
  id: string
  ragioneSociale: string
  partitaIVA: string | null
  sedeLegale: Indirizzo
  pec?: string
  // Ditta (F2-10): il codice fiscale, la ditta e la sede predefinita del ruolo
  codiceFiscale?: string | null
  dittaId?: string
  sedeId?: string
  /** Sedi attive della ditta (la sede predefinita e' quella mostrata in lista) */
  numeroSedi?: number
  /** La P.IVA registrata non passa il controllo di validita': va verificata, mai corretta in automatico */
  partitaIvaDaVerificare?: boolean
  ruoliDitta?: string[]
  // Solo nella risposta di creazione
  dittaEsistente?: boolean
  avvisi?: string[]
  createdAt: string
  updatedAt: string
}

export interface Trasportatore {
  id: string
  ragioneSociale: string
  partitaIVA: string | null
  sedeLegale: Indirizzo
  numeroIscrizione: string // Albo Gestori
  pec?: string
  // Scadenza dell'iscrizione all'Albo Gestori (ISO, solo data). Facoltativa:
  // le anagrafiche esistenti non ce l'hanno (Task 3 dello scadenzario).
  scadenzaIscrizione?: string
  // Stato di scadenza calcolato dal backend (Task 4 dello scadenzario), con
  // la stessa formula del controllo periodico: `false`/`null` quando
  // `scadenzaIscrizione` non è impostata — l'assenza del dato non è mai
  // un'iscrizione scaduta.
  iscrizioneScaduta?: boolean
  giorniAllaScadenza?: number | null
  // Ditta (F2-10): il codice fiscale, la ditta e la sede predefinita del ruolo
  codiceFiscale?: string | null
  dittaId?: string
  sedeId?: string
  /** Sedi attive della ditta (la sede predefinita e' quella mostrata in lista) */
  numeroSedi?: number
  /** La P.IVA registrata non passa il controllo di validita': va verificata, mai corretta in automatico */
  partitaIvaDaVerificare?: boolean
  ruoliDitta?: string[]
  // Solo nella risposta di creazione
  dittaEsistente?: boolean
  avvisi?: string[]
  createdAt: string
  updatedAt: string
}

export interface Destinatario {
  id: string
  ragioneSociale: string
  partitaIVA: string | null
  sede: Indirizzo
  numeroAutorizzazione: string
  pec?: string
  // Scadenza dell'autorizzazione (ISO, solo data). Facoltativa: le
  // anagrafiche esistenti non ce l'hanno (Task 3 dello scadenzario).
  scadenzaAutorizzazione?: string
  // Stato di scadenza calcolato dal backend (Task 4 dello scadenzario), con
  // la stessa formula del controllo periodico: `false`/`null` quando
  // `scadenzaAutorizzazione` non è impostata — l'assenza del dato non è mai
  // un'autorizzazione scaduta.
  autorizzazioneScaduta?: boolean
  giorniAllaScadenza?: number | null
  // Ditta (F2-10): il codice fiscale, la ditta e la sede predefinita del ruolo
  codiceFiscale?: string | null
  dittaId?: string
  sedeId?: string
  /** Sedi attive della ditta (la sede predefinita e' quella mostrata in lista) */
  numeroSedi?: number
  /** La P.IVA registrata non passa il controllo di validita': va verificata, mai corretta in automatico */
  partitaIvaDaVerificare?: boolean
  ruoliDitta?: string[]
  // Solo nella risposta di creazione
  dittaEsistente?: boolean
  avvisi?: string[]
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/** Sede di una ditta (risposta di `registry/ditte`). */
export interface SedeDitta {
  id: string
  denominazione: string | null
  via: string
  civico: string
  cap: string
  citta: string
  provincia: string
  referente: string | null
  email: string | null
  telefono: string | null
  pec: string | null
  principale: boolean
  attiva: boolean
}

export interface Ditta {
  id: string
  ragioneSociale: string
  partitaIva: string | null
  codiceFiscale: string | null
  partitaIvaDaVerificare: boolean
  privato: boolean
  sedi: SedeDitta[]
  ruoli: { produttoreId?: string; trasportatoreId?: string; destinatarioId?: string }
}

export interface CercaDittaRisposta {
  ditta: Ditta | null
}

export interface DatiSedeDitta {
  denominazione?: string
  via: string
  civico: string
  cap: string
  citta: string
  provincia: string
  referente?: string
  email?: string
  telefono?: string
  pec?: string
}
