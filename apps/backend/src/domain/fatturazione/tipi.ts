import type { Scaglione } from '../listino/prezzo-speciale'
import type { Scadenza } from '../listino/scadenze-fisse'
import type { TipoMarcatore, TipoRigaDocumento } from './codici'

/**
 * Ingressi e uscite del calcolo della fatturazione. Tutti gli importi sono stringhe decimali.
 * Il Task 15 aggiunge FotografiaDocumento e DocumentoPerXml.
 */

export interface CodiceIvaDaFatturare {
  id: string
  versione: number
  aliquota: string
  natura: string | null
  descrizione: string
}

/** Riga di un legame confermato da fatturare. */
export interface RigaLegameDaFatturare {
  legameId: string
  rigaLegameId: string
  legameVersione: number
  elencoId: string
  movimentoVigenteId: string
  dataMovimento: string
  /** Quantita e unita del movimento vigente: base delle righe TT e TF (decisione 17). */
  quantitaMovimento: string
  unitaMovimento: string
  cerCode: string
  numeroFir: string | null
  rigaAddebitoId: string
  tipo: string
  descrizione: string | null
  unitaMisura: string
  quantita: string | null
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
}

/** Riga di listino (addebito dell'elenco) con codice IVA, scaglioni e scadenze. */
export interface RigaListinoDaFatturare {
  id: string
  versione: number
  elencoId: string
  daAllegato: boolean
  tipo: string
  descrizione: string | null
  categoriaId: string | null
  /** Codice a 3 cifre della categoria (`CodificaAddebito.codice`): lo riempie il Task 5. */
  categoriaCodice: string | null
  unitaMisura: string
  prezzo: string | null
  quantitaFissa: string | null
  sconto: string | null
  prezzoSpeciale: boolean
  applicaA: string | null
  condizione: number | null
  condizioniRiferite: string | null
  scaglioni: Scaglione[]
  scadenze: Scadenza[]
  periodoScadenze: string | null
  minimoFatturabile: string | null
  minimoPerCategoria: boolean
  codiceIva: CodiceIvaDaFatturare
}

export interface RigaDocumentoCalcolata {
  numeroLinea: number
  tipoRiga: TipoRigaDocumento
  legameId: string | null
  rigaLegameId: string | null
  rigaAddebitoId: string | null
  descrizione: string
  dataMovimento: string | null
  cerCode: string | null
  numeroFir: string | null
  quantita: string | null
  unitaMisura: string | null
  prezzoUnitario: string
  sconto: string | null
  importoLordo: string
  importoSconto: string
  prezzoTotale: string
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
  marcatore?: { tipo: TipoMarcatore; chiaveCompetenza: string }
}

export interface RiepilogoIvaCalcolato {
  aliquota: string
  natura: string | null
  imponibile: string
  imposta: string
  esigibilita: 'I' | 'D' | 'S'
  riferimentoNormativo: string | null
}

export interface RataCalcolata {
  ordine: number
  modalita: string
  dataScadenza: string
  importo: string
  istituto: string | null
  iban: string | null
  abi: string | null
  cab: string | null
  bic: string | null
}
