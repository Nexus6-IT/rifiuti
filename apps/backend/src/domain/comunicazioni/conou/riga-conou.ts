/**
 * Dati di una riga del file CONOU (`Movi.txt`), uno per movimento. Tutti i campi sono gia'
 * risolti dal preparatore: il serializzatore non legge il database e non decide nulla.
 * Date `AAAA-MM-GG` (giorno di calendario, fuso di Roma). Numeri gia' interi.
 */
export interface RigaConou {
  /** Movimento di origine (per i messaggi di errore); non finisce nel file. */
  riferimento: string
  /** Movimento di origine: collega al movimento gli avvisi sui campi (es. caratteri non rappresentabili). */
  movimentoId: string
  cfDetentore: string
  cap: string
  partitaIva: string
  ragioneSociale: string
  indirizzo: string
  civico: string
  provincia: string
  comune: string
  /** `NN.NN.NN` oppure `0000` per un privato. */
  ateco: string
  /** 9 cifre: `0` + regione (2) + comune (6). */
  istat: string
  codiceDeposito: string
  dataRegistrazione: string
  serie: string
  numero: string
  anno: string
  /** Vuota se il movimento non ha FIR. */
  dataFormulario: string
  cfTrasportatore: string
  targa: string
  cer: string
  /** Percentuale di olio x 100, intera (`8499`). */
  percentualeX100: number
  /** Numero di protocollo del registro, intero. */
  protocollo: number
  /** Kg interi, negativi per lo scarico interno. */
  quantitaKg: number
  prodotto: string
  causale: string
}

export interface DatiFileConou {
  righe: RigaConou[]
}
