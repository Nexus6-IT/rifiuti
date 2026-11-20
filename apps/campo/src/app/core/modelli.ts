/** Contratto di `GET /api/v1/campo/giro` (backend: GiroVista / RitiroVista), solo i campi usati. */
export type FasciaRitiro = 'MATTINA' | 'POMERIGGIO';

export interface RitiroVista {
  id: string;
  dataPrevista: string;
  fascia: FasciaRitiro | null;
  ordineGiro: number | null;
  produttore: { id: string; nome: string; sedeId: string; indirizzo: string };
  trasportatore: { id: string; nome: string };
  destinatario: { id: string; nome: string; sedeId: string };
  automezzo: { id: string; targa: string } | null;
  autista: { id: string; nome: string } | null;
  cerCode: string;
  descrizione: string;
  quantitaPresunta: string;
  unita: string;
  stato: string;
  statoVisibile: string;
  motivo: string | null;
  fir: { id: string; numero: string | null; status: string } | null;
  /** Versione del ritiro: la coda la rimanda col suo esito (lock ottimistico lato server). */
  versione: number;
  annotazioni?: string | null;
}

export interface GiroVista {
  data: string;
  autista: { id: string; nome: string; cognome: string };
  ritiri: RitiroVista[];
}
