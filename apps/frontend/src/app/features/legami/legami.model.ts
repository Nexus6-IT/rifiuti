/** Impostazione «fatturazione da» dell'azienda (data AAAA-MM-GG; vuota = fatturazione spenta). */
export interface ImpostazioneFatturazione {
  fatturazioneDa: string | null
  versione: number
  modificatoIl: string | null
}

export interface DatiImpostazioneFatturazione {
  fatturazioneDa: string | null
  versione: number
  /** Numero di movimenti toccati già visto e accettato dall'utente. */
  confermaMovimenti?: number
}
