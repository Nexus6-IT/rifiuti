import { RitiroVista } from './ritiri.model'

export const ritiroDiProva = (p: Partial<RitiroVista> = {}): RitiroVista => ({
  id: 'r1',
  dataPrevista: '2026-11-12',
  fascia: 'MATTINA',
  ordineGiro: 1,
  produttore: { id: 'p1', nome: 'Rossi S.r.l.', sedeId: 's1', indirizzo: 'Via Roma 1, Milano' },
  trasportatore: { id: 't1', nome: 'Trasporti Bianchi' },
  destinatario: { id: 'd1', nome: 'Impianto Verdi', sedeId: 's2' },
  automezzo: { id: 'a1', targa: 'AB123CD' },
  cerCode: '170504',
  descrizione: 'Terre e rocce',
  quantitaPresunta: '1250.50',
  unita: 'kg',
  stato: 'PROGRAMMATO',
  statoVisibile: 'DA_GENERARE',
  motivo: null,
  fir: null,
  serieId: null,
  versione: 1,
  ...p,
})
