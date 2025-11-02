export enum FIRStato {
  BOZZA = 'BOZZA',
  EMESSO = 'EMESSO',
  IN_TRANSITO = 'IN_TRANSITO',
  CONSEGNATO = 'CONSEGNATO',
  ANNULLATO = 'ANNULLATO'
}

export interface FIR {
  id: string;
  numeroProgressivo?: string;
  anno: number;
  stato: FIRStato;
  produttoreId: string;
  trasportatoreId: string;
  destinatarioId: string;
  rifiuto: {
    cerCode: string;
    quantitaDichiarata: number;
    unitaMisura: string;
    statoFisico?: string;
  };
  dataPresaCarico?: string;
  dataConsegna?: string;
  pesoEffettivo?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedFIRResponse {
  items: FIR[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
