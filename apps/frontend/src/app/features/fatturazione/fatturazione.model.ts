/**
 * Modelli della fatturazione per periodo (fase 4.4b). Sono il CONTRATTO dei nomi per i DTO del
 * backend (Task 17-25): un nome diverso si cambia qui, con un commit separato.
 *
 * Questo file non importa nulla da Angular: lo importa anche l'e2e del Task 26a (Q21).
 * Importi e quantità sono stringhe decimali col punto, mai `number`; le date `AAAA-MM-GG`
 * (i timestamp ISO sono solo `createdAt` ed `emessoIl`).
 */

export const STATI_ELABORAZIONE = [
  'IN_CODA',
  'IN_CORSO',
  'ANTEPRIMA_PRONTA',
  'IN_DEFINITIVA',
  'DEFINITIVA',
  'FALLITA',
  'SCARTATA',
] as const
export type StatoElaborazione = (typeof STATI_ELABORAZIONE)[number]

export const STATI_DOCUMENTO = ['BOZZA', 'DEFINITIVO', 'ANNULLATO'] as const
export type StatoDocumento = (typeof STATI_DOCUMENTO)[number]

export type Raggruppamento = 'PER_CONTRATTO' | 'PER_ELENCO'

export interface FiltriElaborazione {
  clienteIds?: string[]
  contrattoIds?: string[]
  categoriaIds?: string[]
  tipiAddebito?: string[]
  registroIvaIds?: string[]
}
// decisione 25: categoriaIds e tipiAddebito scelgono CONTRATTI interi, mai righe (Task 17)

export interface NuovaElaborazione {
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  raggruppamento: Raggruppamento
  includiArretrati: boolean
  filtri: FiltriElaborazione
}

export interface SegnalazioneVista {
  codice: string
  messaggio: string
  dettaglio?: string
}

/** Q9 */
export type MotivoNonAnnullabile =
  | 'NON_DEFINITIVO'
  | 'NOTA_DI_CREDITO'
  | 'STORNATO'
  | 'EMESSO'
  | 'NON_ULTIMO'
/** Q33 */
export type MotivoNonStornabile = 'NON_DEFINITIVO' | 'NOTA_DI_CREDITO'

/** Q3: un documento senza registro non diventa bozza, sta qui. */
export interface DocumentoNonGenerato {
  contrattoId: string
  contrattoNumero: string
  clienteId: string
  denominazione: string
  errori: SegnalazioneVista[]
}

/**
 * `documenti`, `errori` e `avvisi` contano DOCUMENTI: `documenti` solo le bozze scritte, `errori`
 * le bozze con almeno un errore PIU' i documenti non generati (Q3), `avvisi` le bozze con almeno un
 * avviso. Gli errori generali dell'elaborazione (per esempio `CEDENTE_INCOMPLETO`) non entrano in
 * `errori`: stanno in `ElaborazioneDettaglio.erroriGenerali`. `totale` somma tutte le bozze, anche
 * quelle con errori che non saranno emesse.
 */
export interface ElaborazioneRiga {
  id: string
  stato: StatoElaborazione
  createdAt: string
  periodoDal: string
  periodoAl: string
  dataDocumento: string
  documenti: number
  totale: string
  errori: number
  avvisi: number
}

/**
 * `definitiveAttive`: l'interruttore dell'azienda (decisione 13, scansione P34);
 * `errore`: la colonna esito (scansione P5, Q15); `erroreTecnico`: errore_tecnico di una FALLITA (Q17).
 */
export interface ElaborazioneDettaglio extends ElaborazioneRiga {
  raggruppamento: Raggruppamento
  includiArretrati: boolean
  filtri: FiltriElaborazione
  impronta: string | null
  versione: number
  definitiveAttive: boolean
  erroriGenerali: SegnalazioneVista[]
  erroriPeriodo: {
    motivo: string
    quanti: number
    contrattoId: string | null
    /** Assente nei riepiloghi salvati prima del campo. */
    contrattoNumero?: string | null
  }[]
  /** `quanti`: i documenti che la definitiva numererebbe in quel registro (calcolati alla lettura). */
  numerazionePrevista: {
    registroIvaId: string
    codiceRegistro: string
    da: string
    a: string
    quanti: number
  }[]
  totaliPerRegistro: {
    registroIvaId: string
    imponibile: string
    iva: string
    totale: string
  }[]
  documentiNonGenerati: DocumentoNonGenerato[]
  errore: {
    codice: string
    differenze?: { nuovi: number; cambiati: number; fatturatiDaAltri: number }
    ultimaData?: string
  } | null
  erroreTecnico: string | null
}

/**
 * `registro` non nullo: un documento senza registro non diventa bozza (Q3).
 * `motivoNonAnnullabile` è il codice; l'etichetta la dà il vocabolario.
 */
export interface DocumentoRiga {
  id: string
  stato: StatoDocumento
  tipoDocumento: string
  numeroTesto: string | null
  dataDocumento: string
  cliente: { id: string; denominazione: string }
  contratto: { id: string; numero: string }
  registro: { id: string; codice: string }
  totaleImponibile: string
  totaleIva: string
  totaleDocumento: string
  errori: SegnalazioneVista[]
  avvisi: SegnalazioneVista[]
  esclusoDaDefinitiva: boolean
  emessoIl: string | null
  annullabile: boolean
  motivoNonAnnullabile: MotivoNonAnnullabile | null
  stornabile: boolean
}

export interface RigaDocumentoVista {
  numeroLinea: number
  tipoRiga: string
  legameId: string | null
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
  aliquotaIva: string
  naturaIva: string | null
}

export interface RiepilogoIvaVista {
  aliquota: string
  natura: string | null
  imponibile: string
  imposta: string
  esigibilita: 'I' | 'D' | 'S'
  riferimentoNormativo: string | null
}

export interface RataVista {
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
// Q34: elenco chiuso, importi e quantità stringhe col punto; nessun id interno oltre a legameId e rigaAddebitoId

export interface DocumentoDettaglio extends DocumentoRiga {
  righe: RigaDocumentoVista[]
  riepiloghi: RiepilogoIvaVista[]
  rate: RataVista[]
  nettoAPagare: string
  bolloDovuto: boolean
  importoBollo: string | null
  versione: number
  documentoOrigineId: string | null
  stornoId: string | null
  xmlGenerato: boolean
}

export interface ScostamentoRiga {
  legameId: string
  /** Versione del legame: serve alla presa d'atto. */
  versioneLegame: number
  documento: { id: string; numeroTesto: string; dataDocumento: string }
  tipoCorrezione: 'RETTIFICA' | 'ANNULLO' | 'CAMBIO_CER' | 'CAMBIO_CAUSALE'
  quantitaFatturata: string | null
  /** Unità di misura dei due movimenti (può cambiare: 1000 KG → 1 T). */
  unitaFatturata: string | null
  unitaAttuale: string | null
  importoFatturato: string
  quantitaAttuale: string | null
  importoAttuale: string | null
  soloQuantita: boolean
}

export interface Pagina<T> {
  elementi: T[]
  totale: number
  pagina: number
  dimensione: number
}

/** = SelezioneExport del Task 24. */
export interface SelezioneExport {
  registroIvaId?: string
  anno?: number
  numeroDa?: number
  numeroA?: number
  dataDa?: string
  dataA?: string
  clienteId?: string
  documentoIds?: string[]
  elaborazioneId?: string
}

// Q21: costanti esaustive. Un campo in più o in meno nel tipo non compila.
export const CHIAVI_ELABORAZIONE_RIGA: Record<keyof ElaborazioneRiga, true> = {
  id: true,
  stato: true,
  createdAt: true,
  periodoDal: true,
  periodoAl: true,
  dataDocumento: true,
  documenti: true,
  totale: true,
  errori: true,
  avvisi: true,
}

export const CHIAVI_ELABORAZIONE_DETTAGLIO: Record<keyof ElaborazioneDettaglio, true> = {
  ...CHIAVI_ELABORAZIONE_RIGA,
  raggruppamento: true,
  includiArretrati: true,
  filtri: true,
  impronta: true,
  versione: true,
  definitiveAttive: true,
  erroriGenerali: true,
  erroriPeriodo: true,
  numerazionePrevista: true,
  totaliPerRegistro: true,
  documentiNonGenerati: true,
  errore: true,
  erroreTecnico: true,
}

export const CHIAVI_DOCUMENTO_RIGA: Record<keyof DocumentoRiga, true> = {
  id: true,
  stato: true,
  tipoDocumento: true,
  numeroTesto: true,
  dataDocumento: true,
  cliente: true,
  contratto: true,
  registro: true,
  totaleImponibile: true,
  totaleIva: true,
  totaleDocumento: true,
  errori: true,
  avvisi: true,
  esclusoDaDefinitiva: true,
  emessoIl: true,
  annullabile: true,
  motivoNonAnnullabile: true,
  stornabile: true,
}

export const CHIAVI_DOCUMENTO_DETTAGLIO: Record<keyof DocumentoDettaglio, true> = {
  ...CHIAVI_DOCUMENTO_RIGA,
  righe: true,
  riepiloghi: true,
  rate: true,
  nettoAPagare: true,
  bolloDovuto: true,
  importoBollo: true,
  versione: true,
  documentoOrigineId: true,
  stornoId: true,
  xmlGenerato: true,
}

export const CHIAVI_RIGA_DOCUMENTO: Record<keyof RigaDocumentoVista, true> = {
  numeroLinea: true,
  tipoRiga: true,
  legameId: true,
  rigaAddebitoId: true,
  descrizione: true,
  dataMovimento: true,
  cerCode: true,
  numeroFir: true,
  quantita: true,
  unitaMisura: true,
  prezzoUnitario: true,
  sconto: true,
  importoLordo: true,
  importoSconto: true,
  prezzoTotale: true,
  aliquotaIva: true,
  naturaIva: true,
}

export const CHIAVI_SCOSTAMENTO_RIGA: Record<keyof ScostamentoRiga, true> = {
  legameId: true,
  versioneLegame: true,
  documento: true,
  tipoCorrezione: true,
  quantitaFatturata: true,
  unitaFatturata: true,
  unitaAttuale: true,
  importoFatturato: true,
  quantitaAttuale: true,
  importoAttuale: true,
  soloQuantita: true,
}

// --- Export contabile: adattatori e mappature (4.4c, Task 29 e 35) -------------------------------

export const TIPI_MAPPATURA = [
  'CODICE_IVA',
  'CONTO_RICAVI',
  'CLIENTE',
  'PAGAMENTO',
  'REGISTRO',
] as const
export type TipoMappatura = (typeof TIPI_MAPPATURA)[number]

/** Un gestionale contabile verso cui si esporta (`GET /export-contabile/adattatori`). */
export interface AdattatoreVista {
  codice: string
  nome: string
  modalita: 'FILE' | 'API'
  /** `false` = «tracciato non verificato su un'installazione reale» (decisione 15). */
  verificato: boolean
}

/** Una mappatura salvata: chiave di WasteFlow, valore del gestionale. */
export interface MappaturaVista {
  tipo: TipoMappatura
  chiaveWasteflow: string
  valore: string
  versione: number
  /** Testo per l'utente (cliente, aliquota...), risolto dal backend. */
  etichetta: string
}

/** Una chiave che i documenti da esportare richiedono e che l'azienda non ha ancora mappato. */
export interface ChiaveMancante {
  tipo: TipoMappatura
  chiaveWasteflow: string
  /** Testo per l'utente (per esempio «IVA 22%»). */
  etichetta: string
}

/** Voce del `PUT`: `valore: null` cancella la mappatura. */
export interface VoceMappatura {
  tipo: TipoMappatura
  chiaveWasteflow: string
  valore: string | null
  /** Versione letta (`null` = voce nuova): se non corrisponde il backend risponde 409. */
  versione: number | null
}

/** Limiti del backend: voci per richiesta, caratteri della chiave e del valore. */
export const MAX_VOCI_MAPPATURE = 500
export const MAX_CHIAVE_MAPPATURA = 100
export const MAX_VALORE_MAPPATURA = 50

/**
 * Chiave di `sessionStorage` con la `SelezioneExport` dell'export respinto per mappature mancanti
 * (`MAPPATURE_MANCANTI`): la scrive la pagina dei documenti prima di andare alle mappature, la
 * legge la pagina delle mappature (Task 33 e 35). Ogni accesso va in try/catch.
 */
export const CHIAVE_SELEZIONE_MAPPATURE = 'wasteflow.fatturazione.selezioneMappature'
