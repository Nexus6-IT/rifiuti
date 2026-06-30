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
