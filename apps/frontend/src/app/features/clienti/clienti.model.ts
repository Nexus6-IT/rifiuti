// Tipi delle sei tabelle di fatturazione, copiati dalle viste del backend
// (application/clienti/*.service.ts). Importi come stringhe, mai number.

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
