import type { Scaglione } from '../listino/prezzo-speciale'
import type { Scadenza } from '../listino/scadenze-fisse'
import type {
  AvvisoDocumento,
  ErroreDocumento,
  Segnalazione,
  TipoMarcatore,
  TipoRigaDocumento,
} from './codici'

/**
 * Ingressi e uscite del calcolo della fatturazione. Tutti gli importi sono stringhe decimali.
 * Il Task 15 ha aggiunto FotografiaDocumento, FotografiaSalvata e DocumentoPerXml (in fondo).
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
  /**
   * Posizione da 1 della riga nel suo elenco COMPLETO, secondo `ordinaRigheListino` (la stessa che
   * vede l'utente). La legge chi costruisce il listino; se manca il dettaglio cita la posizione
   * nel listino unito del documento.
   */
  posizioneInElenco?: number
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

/** Sede come la vuole l'XML. Nella prima uscita solo clienti italiani (oggi i clienti non hanno nazione, Q27). */
export interface SedeFotografia {
  /** Via ed eventuale civico: l'XSD limita `Indirizzo` a 60 caratteri. */
  indirizzo: string
  cap: string
  comune: string
  provincia: string | null
  nazione: 'IT'
}

/**
 * Dati fiscali congelati alla definitiva (Q16, scansione P37): il documento non cambia se poi
 * cambiano cedente o cliente. L'XML generato dopo usa questa fotografia.
 */
export interface FotografiaDocumento {
  cedente: {
    denominazione: string
    partitaIva: string
    codiceFiscale: string | null
    regimeFiscale: string
    sede: SedeFotografia
    /** `IscrizioneREA` si emette solo se c'e', con ufficio, numero e stato di liquidazione insieme. */
    rea: {
      ufficio: string
      numero: string
      capitaleSociale: string | null
      socioUnico: 'SU' | 'SM' | null
      statoLiquidazione: 'LN' | 'LS'
    } | null
    idTrasmittente: string
  }
  cessionario: {
    denominazione: string | null
    nome: string | null
    cognome: string | null
    partitaIva: string | null
    codiceFiscale: string | null
    sede: SedeFotografia
  }
  pagamento: {
    codice: string
    descrizione: string
    modalita: string
    giorniRate: number[]
    fineMese: boolean
  } | null
  conto: { istituto: string | null; iban: string | null; bic: string | null } | null
  testoFatturazione: string[]
  cig: string | null
  cup: string | null
  idDocumento: string | null
}

/**
 * Forma di `documenti_fattura.fotografia` (Q16): le bozze salvano errori e avvisi completi di
 * dettaglio; la definitiva la riscrive con errori `[]` e gli avvisi. Le colonne `text[]`
 * errori/avvisi restano la fonte dei CHECK.
 */
export interface FotografiaSalvata extends FotografiaDocumento {
  segnalazioni: {
    errori: Segnalazione<ErroreDocumento>[]
    avvisi: Segnalazione<AvvisoDocumento>[]
  }
}

/** Documento salvato, riletto per generare l'XML: dalla fotografia e dalle righe salvate. */
export interface DocumentoPerXml {
  testata: {
    tipoDocumento: 'TD01' | 'TD04' | 'TD24'
    formatoTrasmissione: 'FPR12' | 'FPA12'
    codiceDestinatario: string
    pecDestinatario: string | null
    dataDocumento: string
    numeroTesto: string
    totaleDocumento: string
    bolloDovuto: boolean
    importoBollo: string | null
    esigibilita: 'I' | 'D' | 'S'
    condizioniPagamento: 'TP01' | 'TP02' | null
    origine: { numeroTesto: string; dataDocumento: string } | null
  }
  righe: RigaDocumentoCalcolata[]
  riepiloghi: RiepilogoIvaCalcolato[]
  rate: RataCalcolata[]
  fotografia: FotografiaDocumento
}
