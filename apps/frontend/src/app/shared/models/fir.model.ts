export enum FIRStato {
  BOZZA = 'BOZZA',
  EMESSO = 'EMESSO',
  IN_TRANSITO = 'IN_TRANSITO',
  CONSEGNATO = 'CONSEGNATO',
  ANNULLATO = 'ANNULLATO'
}

/**
 * Firma applicativa (NON qualificata) allegata alle transizioni di stato del FIR.
 * Deriva dall'utente loggato; non sostituisce la firma digitale qualificata.
 */
export interface FirmaApplicativa {
  firmatario: string;
  certificato: string;
}

export interface FIR {
  id: string;
  numeroProgressivo?: string | null;
  /** Anno di riferimento (campo client; non restituito dalla risposta backend). */
  anno: number;
  stato: FIRStato;
  produttoreId: string;
  trasportatoreId: string;
  destinatarioId: string;
  rifiuto: {
    cerCode: string;
    quantita: number;
    unitaMisura: string;
    /** Campo 2 FIR (DM 59/2023): stato fisico del rifiuto. */
    statoFisico?: string;
    /** Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014). */
    caratteristichePericolo?: string;
    /** Campo 2 FIR: numero di colli. */
    numeroColli?: number;
    descrizione?: string;
    categoria?: string;
    /** RECOVERY / DISPOSAL — categoria macro. */
    tipoOperazione?: string;
    /** Campo 3 FIR: codice operazione R/D specifico (es. "R1", "D13"). */
    codiceOperazione?: string;
  };
  /** Campo 17 FIR (DM 59/2023): annotazioni libere. */
  annotazioni?: string | null;
  dataPresaCarico?: string | null;
  dataConsegna?: string | null;
  /** Peso effettivo rilevato alla destinazione (4ª copia). */
  pesoEffettivo?: number | null;
  /** 4ª copia: data restituzione dal destinatario al produttore. */
  fourthCopyReturnedAt?: string | null;
  /** 4ª copia: note/esito del destinatario. */
  fourthCopyNotes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface PaginatedFIRResponse {
  items: FIR[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
