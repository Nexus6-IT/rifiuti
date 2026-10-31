// Tipi di ingresso dei servizi degli accessi. Le classi DTO dell'API (Task 6) li soddisfano.
import type { RuoloApplicativo } from '../../api/me/ruolo-effettivo.service'

export interface UtentePesa {
  id: string
  /** Ruolo EFFETTIVO nell'azienda selezionata. */
  ruolo: RuoloApplicativo
}

export interface FileCaricato {
  nomeFile: string
  mimeDichiarato: string
  contenuto: Buffer
}

export interface PesataManualeDati {
  pesoKg: number
  strumentoId?: string | null
  strumentoEsterno?: string | null
  alibiId?: string | null
  /** ISO 8601 con offset */
  oraStrumento?: string | null
  motivo: string
  stabileDichiarato: boolean
}

export interface AperturaAccessoDati {
  chiaveIdempotenza: string
  registroId?: string | null
  verso: 'CARICO' | 'SCARICO'
  modo: 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'
  automezzoId?: string | null
  targa?: string | null
  targaRimorchio?: string | null
  cerCode?: string | null
  descrizione?: string | null
  note?: string | null
  pesata: PesataManualeDati
}

export interface SecondaPesataDati {
  chiaveIdempotenza: string
  pesata: PesataManualeDati
}

export interface FiltriAccessi {
  registroId?: string
  stato?: 'APERTO' | 'CHIUSO' | 'ANNULLATO'
  /** YYYY-MM-DD, giorno italiano di apertura */
  dal?: string
  al?: string
  targa?: string
  pagina?: number
}
