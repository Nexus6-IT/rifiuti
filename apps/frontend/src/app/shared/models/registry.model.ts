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
  partitaIVA: string
  sedeLegale: Indirizzo
  pec?: string
  createdAt: string
  updatedAt: string
}

export interface Trasportatore {
  id: string
  ragioneSociale: string
  partitaIVA: string
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
  createdAt: string
  updatedAt: string
}

export interface Destinatario {
  id: string
  ragioneSociale: string
  partitaIVA: string
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
