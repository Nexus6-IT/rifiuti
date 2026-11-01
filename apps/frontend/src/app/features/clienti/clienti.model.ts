// Tipi delle sei tabelle di fatturazione, copiati dalle viste del backend
// (application/clienti/*.service.ts), e di agenti, clienti e contratti cliente, copiati dalle
// interfacce `…Vista` del piano della 4.1 (R29: il backend è scritto in parallelo su quelle).
// Importi e percentuali come stringhe, mai number; date `YYYY-MM-DD`.
import { Indirizzo, SedeDitta } from '../../shared/models/registry.model'
import { TipoProvvigione } from '../listino/listino.model'

export type ModalitaPagamento = 'MP01' | 'MP02' | 'MP05' | 'MP08' | 'MP12' | 'MP19' | 'MP23'
export type TipoSpesa = 'INCASSO' | 'BOLLO'
export type GenereCodifica = 'CATEGORIA' | 'TIPO' | 'MOTIVO_ANNULLO'

interface Versionata {
  id: string
  versione: number
  /** Nessun cliente o contratto la cita: si può cancellare invece di disattivare. */
  eliminabile: boolean
}

export interface DatiCondizionePagamento {
  codice: string
  descrizione: string
  modalita: ModalitaPagamento
  giorniRate: number[]
  fineMese: boolean
}

export interface CondizionePagamento extends DatiCondizionePagamento, Versionata {
  attiva: boolean
  /** Es. "30-60 gg fine mese", "a vista". */
  descrizioneRate: string
}

export type ModificaCondizione = Partial<DatiCondizionePagamento> & {
  attiva?: boolean
  versione: number
}

export interface DatiContoCorrente {
  codice: string
  descrizione: string
  banca: string
  iban: string
  bic: string | null
}

/** Dettaglio: IBAN intero. */
export interface ContoCorrente extends DatiContoCorrente, Versionata {
  attivo: boolean
  /** `IT60 **** **** 3456`. */
  ibanMascherato: string
}

/** Riga dell'elenco: l'IBAN intero c'è solo nel dettaglio. */
export type ContoCorrenteInElenco = Omit<ContoCorrente, 'iban'>

/** Il BIC è facoltativo: assente o null = nessun BIC. */
export type NuovoContoCorrente = Omit<DatiContoCorrente, 'bic'> & { bic?: string | null }

export type ModificaContoCorrente = Partial<DatiContoCorrente> & {
  attivo?: boolean
  versione: number
}

export interface DatiSpesaAccessoria {
  tipo: TipoSpesa
  codice: string
  descrizione: string
  /** Importo come stringa decimale, es. "2.00". */
  importo: string
}

export interface SpesaAccessoria extends DatiSpesaAccessoria, Versionata {
  attiva: boolean
}

export type ModificaSpesa = Partial<DatiSpesaAccessoria> & {
  attiva?: boolean
  versione: number
}

export interface DatiRegistroIva {
  codice: string
  descrizione: string
  ricevuteSplit: boolean
}

export interface RegistroIva extends DatiRegistroIva, Versionata {
  attivo: boolean
}

export type ModificaRegistroIva = Partial<DatiRegistroIva> & {
  attivo?: boolean
  versione: number
}

export interface DatiTestoFatturazione {
  codice: string
  titolo: string
  righe: string[]
}

export interface TestoFatturazione extends DatiTestoFatturazione, Versionata {
  attivo: boolean
}

export type ModificaTestoFatturazione = Partial<DatiTestoFatturazione> & {
  attivo?: boolean
  versione: number
}

export interface CodificaContratto extends Versionata {
  genere: GenereCodifica
  codice: string
  descrizione: string
  attiva: boolean
}

/** Codice omesso = primo codice numerico libero del genere. */
export interface NuovaCodifica {
  genere: GenereCodifica
  descrizione: string
  codice?: string | null
}

/** Il genere si sceglie alla creazione e non cambia più. */
export interface ModificaCodifica {
  codice?: string
  descrizione?: string
  attiva?: boolean
  versione: number
}

// ---------------------------------------------------------------------------------------------
// Agenti, clienti, contratti cliente (Task 13-19 del piano)
// ---------------------------------------------------------------------------------------------

export type EsigibilitaIva = 'IMMEDIATA' | 'DIFFERITA' | 'SCISSIONE'
export type StatoContrattoCliente =
  | 'BOZZA'
  | 'ATTIVO'
  | 'SOSPESO'
  | 'SOSPESO_MOVIMENTI'
  | 'ANNULLATO'
export type UnitaValidita = 'A' | 'S' | 'M' | 'G'
/** Solo S e N (Q8). */
export type CodiceRinnovo = 'S' | 'N'

export interface Pagina<T> {
  elementi: T[]
  totale: number
}

export interface FiltroPagina {
  pagina?: number
  dimensione?: number
}

/** Dati della ditta per creare un ruolo (come le altre anagrafiche). */
export interface DatiDittaRuolo {
  ragioneSociale: string
  partitaIva?: string | null
  codiceFiscale?: string | null
  indirizzo: Indirizzo
  /** Denominazione della sede (R37). */
  denominazione?: string | null
  email?: string | null
  telefono?: string | null
  pec?: string | null
  referente?: string | null
}

/** Esito di una creazione di ruolo su una ditta eventualmente già censita. */
export interface EsitoCreazioneRuolo {
  dittaEsistente: boolean
  avvisi: string[]
}

export interface DittaDelRuolo {
  id: string
  ragioneSociale: string
  partitaIva: string | null
  codiceFiscale: string | null
}

/** Riferimento a una riga di tabella: `{ id, codice, descrizione }`. */
export interface Rif {
  id: string
  codice: string | null
  descrizione: string
}

export interface Agente {
  id: string
  versione: number
  attivo: boolean
  codice: string | null
  note: string | null
  ditta: DittaDelRuolo
  sede: SedeDitta
  clienti: number
  contratti: number
  eliminabile: boolean
}

export interface NuovoAgente extends DatiDittaRuolo {
  codice?: string | null
  note?: string | null
  sedeId?: string
}

export interface ModificaAgente {
  codice?: string | null
  note?: string | null
  sedeId?: string
  attivo?: boolean
  versione: number
}

export interface EsitoAgente extends EsitoCreazioneRuolo {
  agente: Agente
}

export interface DatiFiscaliCliente {
  codice: string | null
  codiceDestinatario: string | null
  pecFatturazione: string | null
  riferimentoAmministrazione: string | null
  iban: string | null
  contoCorrenteId: string | null
  condizionePagamentoId: string | null
  esigibilitaIva: EsigibilitaIva
  registroIvaId: string | null
  speseIncassoId: string | null
  bolloId: string | null
  agenteId: string | null
  ritenutaPercentuale: string | null
  nome: string | null
  cognome: string | null
  note: string | null
  /** Facoltativi (R14): le fixture dei contratti cliente non li conoscono. */
  listino?: number | null
  provvigionePredefinita?: string | null
  tipoProvvigionePredefinita?: TipoProvvigione | null
}

export interface Cliente extends DatiFiscaliCliente {
  id: string
  versione: number
  attivo: boolean
  ditta: DittaDelRuolo & { privato: boolean }
  sedeFatturazione: SedeDitta
  condizionePagamento: Rif | null
  contoCorrente: Rif | null
  registroIva: Rif | null
  speseIncasso: Rif | null
  bollo: Rif | null
  agente: Rif | null
  contratti: number
  eliminabile: boolean
}

export interface NuovoCliente extends DatiDittaRuolo, Partial<DatiFiscaliCliente> {
  sedeId?: string
}

/** Campo assente = invariato; `null` svuota. Mai gli identificativi della ditta. */
export type ModificaCliente = {
  [K in keyof DatiFiscaliCliente]?: DatiFiscaliCliente[K] | null
} & { sedeId?: string; attivo?: boolean; versione: number }

export interface EsitoCliente extends EsitoCreazioneRuolo {
  cliente: Cliente
}

export interface PeriodoFatturazione {
  giornoInizio: number
  meseInizio: number
  giornoFine: number
  meseFine: number
}

export interface DatiContrattoCliente {
  numero: string
  descrizione: string
  clienteId: string
  clienteFatturazioneId: string | null
  sedeId: string | null
  categoriaId: string | null
  tipoId: string | null
  dataInizio: string | null
  dataFine: string | null
  dataStipula: string | null
  validitaQuantita: number | null
  validitaUnita: UnitaValidita | null
  contrattoPrincipaleId: string | null
  condizionePagamentoId: string | null
  contoCorrenteId: string | null
  speseIncassoId: string | null
  bolloId: string | null
  registroIvaId: string | null
  esigibilitaIva: EsigibilitaIva
  ritenutaPercentuale: string | null
  agenteId: string | null
  testoFatturazioneId: string | null
  codiceDestinatario: string | null
  riferimentoAmministrazione: string | null
  codiceCig: string | null
  codiceCup: string | null
  idDocumentoPa: string | null
  escludiDichiarazioneIntento: boolean
  sogliaDal: string | null
  sogliaImporto: string | null
  sogliaIvaEsclusa: boolean
  rinnovoAutomatico: boolean
  codiceRinnovo: CodiceRinnovo | null
  incrementoIstat: boolean
  commessa: string | null
  /** Al massimo 3, ciascuna fino a 45 caratteri. */
  annotazioni: string[]
  /** Al massimo 12; vuoto = si fattura a ogni elaborazione. */
  periodi: PeriodoFatturazione[]
}

export type CampoContrattoCliente = keyof DatiContrattoCliente

export interface AllegatoPdfSintesi {
  posizione: 1 | 2
  nomeFile: string
}

export interface ContrattoCliente extends DatiContrattoCliente {
  id: string
  stato: StatoContrattoCliente
  versione: number
  motivoAnnullo: string | null
  motivoAnnulloCodifica: Rif | null
  annullatoIl: string | null
  cliente: { id: string; ragioneSociale: string; partitaIva: string | null; attivo: boolean }
  clienteFatturazione: { id: string; ragioneSociale: string; partitaIva: string | null } | null
  /** "Via X 1, Comune (PR)". */
  sede: { id: string; descrizione: string } | null
  categoria: Rif | null
  tipo: Rif | null
  condizionePagamento: Rif | null
  contoCorrente: Rif | null
  speseIncasso: Rif | null
  bollo: Rif | null
  registroIva: Rif | null
  agente: Rif | null
  testoFatturazione: Rif | null
  /** Conto del contratto, altrimenti quello del cliente (D4). */
  contoCorrenteEffettivo: Rif | null
  contrattoPrincipale: { id: string; numero: string } | null
  allegati: number
  allegatiPdf: AllegatoPdfSintesi[]
  scaduto: boolean
  prossimaFinePeriodo: string | null
  modificabili: CampoContrattoCliente[]
  transizioni: StatoContrattoCliente[]
  eliminabile: boolean
  rinnovabile: boolean
}

/** Numero, descrizione, cliente e data di inizio sono obbligatori; il resto eredita dal cliente. */
export type NuovoContrattoCliente = Partial<DatiContrattoCliente> &
  Pick<DatiContrattoCliente, 'numero' | 'descrizione' | 'clienteId'> & { dataInizio: string }

/** Campo assente = invariato; `null` svuota solo i campi facoltativi. */
export type ModificaContrattoCliente = {
  [K in CampoContrattoCliente]?: DatiContrattoCliente[K] | null
} & { versione: number }

export interface CambioStatoContratto {
  stato: StatoContrattoCliente
  versione: number
  motivoAnnulloId?: string | null
  /** Testo libero, al massimo 255 caratteri. */
  motivo?: string | null
}

export interface ProrogaScadenze {
  scadutiEntro: string
  soloRinnovoAutomatico?: boolean
  ancheSospesi?: boolean
  clienteId?: string
  categoriaId?: string
}

export interface FiltroContratti extends FiltroPagina {
  stato?: StatoContrattoCliente
  clienteId?: string
  categoriaId?: string
  tipoId?: string
  testo?: string
  inScadenzaEntroGiorni?: number
}

export interface FiltroRuolo extends FiltroPagina {
  testo?: string
  soloAttivi?: boolean
}

export interface AllegatoContratto {
  id: string
  posizione: 1 | 2
  nomeFile: string
  dimensioneByte: number
  caricatoIl: string
}
