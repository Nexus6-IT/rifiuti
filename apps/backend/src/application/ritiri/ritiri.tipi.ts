/**
 * Tipi del servizio dei ritiri programmati (4.7, T10). Il contratto di lettura è `RitiroVista`
 * (P7 §9); quello di scrittura rispecchia `ritiri.model.ts` del frontend: numeri decimali come
 * stringa, date come 'AAAA-MM-GG'.
 */
import type { ProvenienzaRifiuto, TipoTratta, WasteOperationType } from '@prisma/client'
import type { FasciaRitiro, StatoRitiro, StatoVisibileRitiro } from '../../domain/ritiri'

export interface RitiroFirVista {
  id: string
  numero: string | null
  status: string
}

export interface RitiroVista {
  id: string
  dataPrevista: string
  fascia: FasciaRitiro | null
  ordineGiro: number | null
  produttore: { id: string; nome: string; sedeId: string; indirizzo: string }
  trasportatore: { id: string; nome: string }
  destinatario: { id: string; nome: string; sedeId: string }
  automezzo: { id: string; targa: string } | null
  cerCode: string
  descrizione: string
  quantitaPresunta: string
  unita: string
  stato: StatoRitiro
  statoVisibile: StatoVisibileRitiro
  motivo: string | null
  fir: RitiroFirVista | null
  /** Solo nel dettaglio: i FIR annullati generati prima. */
  firPrecedenti?: RitiroFirVista[]
  serieId: string | null
  versione: number
  /** Solo nel dettaglio (servono alla modifica). */
  statoFisico?: string | null
  caratteristichePericolo?: string | null
  numeroColli?: number | null
  codiceOperazione?: string | null
  tipoOperazione?: WasteOperationType
  provenienza?: ProvenienzaRifiuto | null
  tipoTratta?: TipoTratta | null
  annotazioni?: string | null
  noteInterne?: string | null
}

export interface ElencoRitiri {
  righe: RitiroVista[]
  totale: number
}

export interface FiltriRitiri {
  dal?: string
  al?: string
  automezzoId?: string
  trasportatoreId?: string
  produttoreId?: string
  cerCode?: string
  statoVisibile?: StatoVisibileRitiro
  pagina?: number
  dimensione?: number
}

export interface RipetizioneRitiro {
  ogniGiorni?: number
  ogniSettimane?: number
  fino: string
}

/** Campi comuni a creazione e modifica. */
export interface DatiRitiro {
  dataPrevista: string
  fascia?: FasciaRitiro | null
  ordineGiro?: number | null
  produttoreId: string
  produttoreSedeId: string
  trasportatoreId: string
  destinatarioId: string
  destinatarioSedeId: string
  automezzoId?: string | null
  cerCode: string
  descrizione: string
  statoFisico?: string | null
  caratteristichePericolo?: string | null
  numeroColli?: number | null
  quantitaPresunta: string
  unita?: string
  /** Obbligatorio (R/D): il tipo di operazione ne deriva, non si indica a parte. */
  codiceOperazione: string
  provenienza?: ProvenienzaRifiuto | null
  tipoTratta?: TipoTratta | null
  annotazioni?: string | null
  noteInterne?: string | null
}

export interface NuovoRitiro extends DatiRitiro {
  chiaveIdempotenza: string
  ripetizione?: RipetizioneRitiro
}

export interface ModificaRitiro extends DatiRitiro {
  versione: number
}

export interface RisultatoCreazioneRitiri {
  ritiri: RitiroVista[]
  giaRegistrato: boolean
}
