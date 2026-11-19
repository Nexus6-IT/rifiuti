/** Contratto dell'anagrafica autisti: date come 'AAAA-MM-GG', mai id di altre aziende. */
export interface DatiAutista {
  nome: string
  cognome: string
  codiceFiscale?: string | null
  trasportatoreId?: string | null
  patenteNumero?: string | null
  patenteCategoria?: string | null
  patenteScadenza?: string | null
  cqcScadenza?: string | null
  adrScadenza?: string | null
  telefono?: string | null
  /** Utente `AUTISTA` dell'azienda con cui l'autista entra nell'app. */
  userId?: string | null
  /** Solo in aggiornamento: se assente resta invariato. */
  attivo?: boolean
}

export interface AutistaVista {
  id: string
  nome: string
  cognome: string
  codiceFiscale: string | null
  trasportatoreId: string | null
  patenteNumero: string | null
  patenteCategoria: string | null
  patenteScadenza: string | null
  cqcScadenza: string | null
  adrScadenza: string | null
  telefono: string | null
  userId: string | null
  attivo: boolean
}
