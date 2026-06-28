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
    statoFisico?: string;
    caratteristichePericolo?: string;
    descrizione?: string;
    categoria?: string;
    tipoOperazione?: string;
  };
  dataPresaCarico?: string | null;
  dataConsegna?: string | null;
  pesoEffettivo?: number | null;
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
