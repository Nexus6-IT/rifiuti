export enum FIRStato {
  BOZZA = 'BOZZA',
  EMESSO = 'EMESSO',
  IN_TRANSITO = 'IN_TRANSITO',
  CONSEGNATO = 'CONSEGNATO',
  ANNULLATO = 'ANNULLATO',
}

/**
 * Firma applicativa (NON qualificata) allegata alle transizioni di stato del FIR.
 * Deriva dall'utente loggato; non sostituisce la firma digitale qualificata.
 */
export interface FirmaApplicativa {
  firmatario: string
  certificato: string
}

/**
 * Snapshot anagrafico immutabile di una parte del FIR (produttore, trasportatore
 * o destinatario), "congelato" alla creazione a partire dai registri. NON è un
 * riferimento vivo: conserva i dati così com'erano (documento legale).
 */
export interface ParteFIR {
  registroId?: string
  ragioneSociale: string
  partitaIva: string
  indirizzo?: string
  targaVeicolo?: string
  contatto?: string
}

export interface FIR {
  id: string
  numeroProgressivo?: string | null
  /** Anno di riferimento (campo client; non restituito dalla risposta backend). */
  anno: number
  stato: FIRStato
  produttoreId: string
  trasportatoreId: string
  destinatarioId: string
  /** Snapshot anagrafico del produttore (congelato alla creazione). */
  produttore?: ParteFIR | null
  /** Snapshot anagrafico del trasportatore (congelato alla creazione). */
  trasportatore?: ParteFIR | null
  /** Snapshot anagrafico del destinatario (congelato alla creazione). */
  destinatario?: ParteFIR | null
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura: string
    /** Campo 2 FIR (DM 59/2023): stato fisico del rifiuto. */
    statoFisico?: string
    /** Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014). */
    caratteristichePericolo?: string
    /** Campo 2 FIR: numero di colli. */
    numeroColli?: number
    descrizione?: string
    categoria?: string
    /** RECOVERY / DISPOSAL — categoria macro. */
    tipoOperazione?: string
    /** Campo 3 FIR: codice operazione R/D specifico (es. "R1", "D13"). */
    codiceOperazione?: string
  }
  /** Campo 17 FIR (DM 59/2023): annotazioni libere. */
  annotazioni?: string | null
  dataPresaCarico?: string | null
  dataConsegna?: string | null
  /** Peso effettivo rilevato alla destinazione (4ª copia). */
  pesoEffettivo?: number | null
  /** 4ª copia: data restituzione dal destinatario al produttore. */
  fourthCopyReturnedAt?: string | null
  /** 4ª copia: note/esito del destinatario. */
  fourthCopyNotes?: string | null
  createdAt: string
  updatedAt?: string

  /**
   * Stato RENTRI (R1 Task 3): mostrato nella lista formulari, non in un
   * pannello separato — è il dato che l'operatore cerca senza cambiare
   * pagina. Valori reali: PENDING | SYNCING | SYNCED | FAILED |
   * PERMANENTLY_FAILED (v. backend RENTRISyncStatus).
   */
  rentriSyncStatus?: RENTRISyncStatusValue
  /** Numero FIR ufficiale RENTRI (legame confermato). */
  rentriNumeroFir?: string | null
  /**
   * Numero FIR proposto in modalità ibrida, in attesa di conferma esplicita
   * dell'operatore: NON è ancora il legame ufficiale (v. rentriNumeroFir).
   */
  rentriNumeroFirProposto?: string | null
  /** Come è nato il legame con rentriNumeroFir. */
  rentriOrigineLegame?: 'TRASMESSO_DA_NOI' | 'ACQUISITO_DA_TERZI' | 'AGGANCIO_MANUALE' | null
  /** Ultimo messaggio di errore dell'ultima trasmissione fallita (tecnico — v. rentriMessaggioErrore per l'utente). */
  rentriLastSyncError?: string | null
  /**
   * Messaggio azionabile dell'ultimo fallimento, già tradotto dal backend
   * (R1 Task 5): mai un codice o un ProblemDetails grezzo. `null`/assente se
   * non c'è un fallimento da mostrare.
   */
  rentriMessaggioErrore?: string | null
  /**
   * Azione proposta per l'ultimo fallimento: RIPROVA abilita il pulsante
   * «Riprova», VEDI_CERTIFICATO rimanda alla pagina del certificato, NESSUNA
   * nasconde qualunque azione manuale (v. backend rentri-error-presentation.ts).
   */
  rentriAzioneErrore?: 'RIPROVA' | 'VEDI_CERTIFICATO' | 'NESSUNA' | null
  /** Numero di tentativi di trasmissione effettuati. */
  rentriSyncAttempts?: number
  /** Se true, il FIR è trasmissibile ora a RENTRI (stato + non già legato + nessun fallimento permanente). */
  canSyncToRENTRI?: boolean
}

/** Stati reali di sincronizzazione RENTRI (v. backend RENTRISyncStatus). */
export type RENTRISyncStatusValue =
  | 'PENDING'
  | 'SYNCING'
  | 'SYNCED'
  | 'FAILED'
  | 'PERMANENTLY_FAILED'

export interface PaginatedFIRResponse {
  items: FIR[]
  total: number
  page: number
  limit: number
  totalPages: number
}
