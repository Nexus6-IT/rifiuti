// Modelli del listino. 4.2a (Task 12): copiano le `…Vista` dei Task 8-9 e 10 del piano. 4.2b
// (Task 26): elenchi, righe, azioni, variazioni dei contratti, ISTAT, scritti dalle interfacce
// corrette dall'addendum (R36 errori per campo, R45 esito della copia, R46 anteprima propria).
// Prezzi, sconti, provvigioni e aliquote viaggiano come stringhe decimali, mai `number` (R12).

import { StatoContrattoCliente } from '../clienti/clienti.model'

interface Versionata {
  id: string
  versione: number
  /** Nessun addebito la cita: si può cancellare invece di disattivare. */
  eliminabile: boolean
}

// --- Codici IVA -------------------------------------------------------------------------------

export interface DatiCodiceIva {
  /** Da 1 a 3 lettere o cifre, maiuscole. */
  codice: string
  descrizione: string
  /** Decimale a due cifre, es. "22.00". */
  aliquota: string
  /** Obbligatoria con aliquota zero, vietata altrimenti. */
  natura: string | null
  attivo: boolean
}

export interface CodiceIva extends DatiCodiceIva, Versionata {}

export type NuovoCodiceIva = Omit<DatiCodiceIva, 'attivo'> & { attivo?: boolean }

export type ModificaCodiceIva = Partial<DatiCodiceIva> & { versione: number }

// --- Codifiche di addebito --------------------------------------------------------------------

export type GenereCodificaAddebito =
  | 'GRUPPO'
  | 'CATEGORIA'
  | 'CATEGORIA_STATISTICA_1'
  | 'CATEGORIA_STATISTICA_2'
  | 'CENTRO_RICAVO'

export interface CodificaAddebito extends Versionata {
  genere: GenereCodificaAddebito
  /** Tre cifre (`007`). */
  codice: string
  descrizione: string
  attiva: boolean
}

/** Codice omesso = primo codice libero del genere (aggiunta in linea). */
export interface NuovaCodificaAddebito {
  genere: GenereCodificaAddebito
  descrizione: string
  codice?: string | null
}

/** Il genere si sceglie alla creazione e non cambia più. */
export interface ModificaCodificaAddebito {
  codice?: string
  descrizione?: string
  attiva?: boolean
  versione: number
}

// --- Archivio addebiti ------------------------------------------------------------------------

export type TipoProvvigione = 'SCONTATO' | 'LORDO'

export type NumeroListino = 1 | 2 | 3 | 4 | 5 | 6

export interface PrezzoListino {
  numero: NumeroListino
  prezzo: string | null
  /** Cascata di percentuali (`10+5`). */
  sconto: string | null
  provvigione: string | null
}

export interface RiferimentoCodifica {
  id: string
  codice: string
  descrizione: string
}

export interface Addebito {
  id: string
  codice: string
  descrizione: string
  gruppo: RiferimentoCodifica
  unitaMisura: string
  codiceIva: RiferimentoCodifica | null
  tipo: string
  etichettaTipo: string
  categoria: RiferimentoCodifica | null
  tipoProvvigione: TipoProvvigione
  centroRicavo: RiferimentoCodifica | null
  categoriaStatistica1: RiferimentoCodifica | null
  categoriaStatistica2: RiferimentoCodifica | null
  notaUsoInterno: string | null
  appunti: string | null
  /** Sempre sei, per numero. */
  listini: PrezzoListino[]
  attivo: boolean
  versione: number
  eliminabile: boolean
}

export interface DatiAddebito {
  /** Vuoto = lo assegna il server (aggiunta in linea). */
  codice?: string | null
  descrizione: string
  gruppoId: string
  unitaMisura: string
  codiceIvaId?: string | null
  tipo: string
  categoriaId?: string | null
  tipoProvvigione: TipoProvvigione
  centroRicavoId?: string | null
  categoriaStatistica1Id?: string | null
  categoriaStatistica2Id?: string | null
  notaUsoInterno?: string | null
  appunti?: string | null
  listini: PrezzoListino[]
  attivo?: boolean
}

export type ModificaAddebito = Partial<DatiAddebito> & { versione: number }

export interface FiltroAddebiti {
  testo?: string
  tipo?: string
  soloAttivi?: boolean
  pagina?: number
  dimensione?: number
}

// --- Variazione dei prezzi dell'archivio (E22) ------------------------------------------------

export type TipoVariazione =
  | 'AUMENTO_PERCENTUALE'
  | 'AUMENTO_IMPORTO'
  | 'DIMINUZIONE_PERCENTUALE'
  | 'DIMINUZIONE_IMPORTO'
  | 'SOSTITUZIONE_IVA'

export interface FiltroVariazioneArchivio {
  addebitiIds?: string[]
  categorieIds?: string[]
  tipi?: string[]
  listini?: NumeroListino[]
}

export interface CorpoVariazione<F = FiltroVariazioneArchivio> {
  tipo: TipoVariazione
  /** Stringa decimale (R12). */
  valore?: string
  daCodiceIvaId?: string
  aCodiceIvaId?: string
  filtri: F
}

export interface AnteprimaVariazione {
  totale: number
  righe: { id: string; descrizione: string; listino: number; prima: string; dopo: string }[]
  errori: { id: string; descrizione: string; messaggio: string }[]
  impronta: string
}

/** Risposta dell'applicazione della variazione (R24). */
export interface EsitoVariazione {
  aggiornati: number
}

// === 4.2b: elenchi e righe del contratto =====================================================

export type StatoContratto = StatoContrattoCliente

/** Periodo cui si riferisce ogni scadenza di un fisso (D14); `XA`, `XD` e `YC` sono extra. */
export type PeriodoScadenze =
  | 'MP' | 'BA' | 'BP' | 'TA' | 'TP' | 'QA' | 'QP' | 'SA' | 'SP' | 'AA' | 'AP' | 'DA' | 'DP' | 'XA' | 'XD' | 'YC' // prettier-ignore

/** Contesto dell'intestazione: `GET /contratti-clienti/:id/elenchi` (Task 20). */
export interface ContestoListino {
  contratto: {
    id: string
    numero: string
    stato: StatoContratto
    clienteId: string
    /** Il contratto di cui questo è un allegato, se lo è. */
    contrattoPrincipale: { id: string; numero: string } | null
    dataInizio: string
    dataFine: string | null
  }
}

export interface DatiElenco {
  /** Da 1 a 3 caratteri alfanumerici; vuoto in creazione = il primo libero. */
  codice: string
  descrizione: string
  nota1: string | null
  nota2: string | null
  /** `YYYY-MM-DD`; entrambe o nessuna. */
  validoDal: string | null
  validoAl: string | null
  predefinito: boolean
  codiceCig: string | null
  codiceCup: string | null
  idDocumentoPa: string | null
  dataDocumentoPa: string | null
}

export interface AllegatoElenco {
  id: string
  posizione: 1 | 2
  nomeFile: string
  dimensioneByte: number
}

export interface ElencoAddebiti extends DatiElenco {
  id: string
  contrattoId: string
  /** Numero delle righe. */
  righe: number
  versione: number
  /** D16: falso con il contratto annullato. */
  modificabile: boolean
  eliminabile: boolean
  allegati: AllegatoElenco[]
}

export interface ElenchiContratto {
  contesto: ContestoListino
  elenchi: ElencoAddebiti[]
}

export type NuovoElenco = Partial<DatiElenco> & Pick<DatiElenco, 'descrizione'>

export type ModificaElenco = Partial<DatiElenco> & { versione: number }

export type TipoQuantita = 'PESO_NETTO' | 'PESO_LORDO' | 'VOLUME' | 'UNO' | 'ALTRO'

export type TipologiaRifiuto = 'URBANO' | 'URBANO_PERICOLOSO' | 'SPECIALE' | 'SPECIALE_PERICOLOSO'

export type ApplicaPrezzoSpeciale =
  | 'DOCUMENTO'
  | 'PERIODO'
  | 'PROGRESSIVO_DA_DATA'
  | 'CONGUAGLIO_365'
  | 'GIORNO'

export type TipoCalcoloScaglione = 'A' | 'B' | 'C' | 'D' | 'E' | 'X' | 'Y' | 'Z' | 'W' | 'H'

export interface Scaglione {
  /** 1-7: la 7 è "oltre", senza soglia. */
  ordine: number
  finoA: string | null
  prezzo: string
  sconto: string | null
  provvigione: string | null
  tipoCalcolo: TipoCalcoloScaglione
}

export interface Scadenza {
  ordine: number
  giorno: number
  mese: number
  /** Vuoto = ogni anno. */
  anno: number | null
}

export interface RigaAddebito {
  id: string
  elencoId: string
  tipo: string
  etichettaTipo: string
  famiglia: string
  cerCode: string | null
  addebito: { id: string; codice: string; descrizione: string } | null
  riferimento: string | null
  descrizione: string | null
  tipoQuantita: TipoQuantita | null
  quantitaFissa: string | null
  unitaMisura: string
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIva: { id: string; codice: string; descrizione: string }
  provvigione: string | null
  tipoProvvigione: TipoProvvigione | null
  tipologiaRifiuto: TipologiaRifiuto | null
  statoFisico: string | null
  operazione: string | null
  categoria: RiferimentoCodifica | null
  centroRicavo: RiferimentoCodifica | null
  applicaA: ApplicaPrezzoSpeciale | null
  scaglioni: Scaglione[]
  condizione: number | null
  condizioniRiferite: string | null
  minimoFatturabile: string | null
  minimoPerCategoria: boolean
  riferimentoGiorno: number | null
  riferimentoMese: number | null
  periodoScadenze: PeriodoScadenze | null
  periodoExtraDal: string | null
  periodoExtraAl: string | null
  scadenze: (Scadenza & { fatturabileNelContratto: boolean })[]
  stimaAnnuaKg: string | null
  cerProposta: string[]
  addebitiProposti: string[]
  appunti: string | null
  notaUsoInterno: string | null
  versione: number
}

/** Corpo di creazione e modifica di una riga: le chiavi sono quelle di `CampoRiga` (Task 17). */
export type DatiRiga = Partial<
  Omit<
    RigaAddebito,
    | 'id'
    | 'elencoId'
    | 'etichettaTipo'
    | 'famiglia'
    | 'addebito'
    | 'codiceIva'
    | 'categoria'
    | 'centroRicavo'
    | 'scadenze'
    | 'versione'
  >
> & {
  addebitoId?: string | null
  codiceIvaId?: string
  categoriaId?: string | null
  centroRicavoId?: string | null
  scadenze?: Scadenza[]
}

export type ModificaRiga = DatiRiga & { versione: number }

/** R36: ogni errore di validazione di una riga porta il campo (o null se riguarda più campi). */
export interface ErroreRiga {
  campo: string | null
  messaggio: string
}

/** `GET /contratti-clienti/:id/righe-proposta` (D6, D7). */
export interface PropostaRiga {
  descrizione: string | null
  unitaMisura: string | null
  codiceIva: { id: string; codice: string; descrizione: string } | null
  tipo: string | null
  categoria: RiferimentoCodifica | null
  centroRicavo: RiferimentoCodifica | null
  prezzo: string | null
  sconto: string | null
  provvigione: string | null
  tipoProvvigione: TipoProvvigione | null
  tipologiaRifiuto: TipologiaRifiuto | null
}

export type TabellaCodificheRentri = 'stati-fisici' | 'attivita-rs'

export interface CodificaRentri {
  /** Codice della codifica RENTRI (R42), da scrivere in `statoFisico` / `operazione`. */
  codice: string
  descrizione: string
}

// --- Azioni sul listino (D18, D19, R45) ------------------------------------------------------

/** R45: `condizioni` conta le righe saltate per le regole di condizione. */
export interface EsitoCopia {
  copiate: number
  escluse: {
    minimi: number
    acconti: number
    conguagli: number
    duplicate: number
    condizioni: number
  }
}

export interface EsitoImpostazione {
  aggiornate: number
  speciali: number
  escluse: number
}

// --- Variazione dei prezzi dei contratti e ISTAT (D20, D22, R46) -------------------------------

export interface FiltroVariazioneContratti {
  addebitoId?: string
  cerCode?: string
  clienteId?: string
  riferimento?: string
  prezzoAttuale?: string
  anchePrezziZero?: boolean
  tipiPrezzo?: ('NORMALE' | 'SPECIALE')[]
  tipi?: string[]
  categorieAddebitoIds?: string[]
  centriRicavoIds?: string[]
  tipiContrattoIds?: string[]
  categorieContrattoIds?: string[]
  inizioDal?: string
  inizioAl?: string
  fineDal?: string
  fineAl?: string
  contrattiIds?: string[]
  addebitiIds?: string[]
  primaScadenzaFissi?: string
}

export interface CorpoVariazioneContratti extends CorpoVariazione<FiltroVariazioneContratti> {
  soloMinimi?: boolean
}

/** R46: forma propria, diversa dall'anteprima dell'archivio. */
export interface AnteprimaVariazioneContratti {
  totale: number
  righe: {
    id: string
    cliente: string | null
    contratto: string
    elenco: string
    voce: string
    prima: string
    dopo: string
  }[]
  errori: { id: string; voce: string; messaggio: string }[]
  impronta: string
}

export interface MeseIstat {
  anno: number
  mese: number
  contratti: number
}

export interface PercentualeIstat {
  anno: number
  mese: number
  percentuale: string
}

export interface CorpoIstat {
  percentuali: PercentualeIstat[]
  tipi: string[]
}
