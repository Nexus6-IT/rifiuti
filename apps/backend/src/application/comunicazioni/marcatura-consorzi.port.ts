import type { Consorzio, Marcatura } from '../../domain/comunicazioni/classifica-consorzio'

/**
 * Porta del servizio di marcatura per consorzio (4.9b): regole per azienda e correzione sul singolo
 * movimento. Il controller `/comunicazioni/consorzi` dipende solo da qui, via il token
 * `MARCATURA_CONSORZI_SERVICE`.
 */
export const MARCATURA_CONSORZI_SERVICE = Symbol('MARCATURA_CONSORZI_SERVICE')

export interface RegolaConsorzioVista {
  /** `null` per le regole di sistema, che non si modificano. */
  id: string | null
  consorzio: Consorzio
  verso: 'CARICO' | 'SCARICO' | null
  /** Le sole cifre del CER: 2 o 4 (prefisso) oppure 6 (esatto). */
  cer: string
  cerEsatto: boolean
  causaleCodice: string | null
  registroId: string | null
  attiva: boolean
  /** `AAAA-MM-GG`. */
  validaDal: string
  sistema: boolean
  /** Falsa se l'azienda ha regole proprie per quel consorzio: quella di sistema non vale. */
  inVigore: boolean
}

export interface InputRegolaConsorzio {
  consorzio: string
  verso?: string | null
  /** Il CER in qualunque forma: 2 o 4 cifre = prefisso, 6 cifre = codice esatto. */
  cer: string
  causaleCodice?: string | null
  registroId?: string | null
  attiva?: boolean
  /** `AAAA-MM-GG`; `null` o assente in creazione = da sempre; `null` in modifica riporta a «da sempre», assente = invariata. */
  validaDal?: string | null
}

export interface MarcaturaMovimentoVista {
  marcature: Marcatura[]
  /** Consorzi che una regola prenderebbe ma che sono stati esclusi a mano. */
  esclusi: Consorzio[]
}

export interface MarcaturaConsorziPort {
  elencaRegole(tenantId: string): Promise<RegolaConsorzioVista[]>
  creaRegola(
    tenantId: string,
    userId: string,
    input: InputRegolaConsorzio
  ): Promise<RegolaConsorzioVista>
  modificaRegola(
    tenantId: string,
    id: string,
    input: InputRegolaConsorzio
  ): Promise<RegolaConsorzioVista>
  eliminaRegola(tenantId: string, id: string): Promise<void>
  /** Marcatura manuale (`escluso` false) o esclusione manuale (`escluso` true) di un movimento. */
  impostaOverride(
    tenantId: string,
    userId: string,
    movimentoId: string,
    consorzio: string,
    escluso: boolean
  ): Promise<MarcaturaMovimentoVista>
  rimuoviOverride(
    tenantId: string,
    movimentoId: string,
    consorzio: string
  ): Promise<MarcaturaMovimentoVista>
  /** Consorzi di ciascun movimento indicato (per l'etichetta nel registro). */
  consorziDeiMovimenti(
    tenantId: string,
    movimentoIds: string[]
  ): Promise<Record<string, MarcaturaMovimentoVista>>
}

export const ESTRATTO_CONSORZI_SERVICE = Symbol('ESTRATTO_CONSORZI_SERVICE')

export interface EstrattoConsorzio {
  nomeFile: string
  /** CSV con BOM, separatore `;`. */
  csv: string
  righe: number
}

export interface EstrattoConsorziPort {
  estratto(
    tenantId: string,
    params: { consorzio: string; da: string; a: string; unitaLocaleId?: string }
  ): Promise<EstrattoConsorzio>
}

/** Dati non validi (consorzio, CER, verso, data, riferimenti): risponde 400. */
export class MarcaturaNonValidaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarcaturaNonValidaError'
  }
}

/** Il consorzio di una regola esistente non si cambia (si elimina e si crea): risponde 400. */
export class ConsorzioRegolaNonModificabileError extends MarcaturaNonValidaError {
  constructor() {
    super('Il consorzio di una regola non si può cambiare: elimina la regola e creane un’altra.')
    this.name = 'ConsorzioRegolaNonModificabileError'
  }
}

export class RegolaConsorzioNonTrovataError extends Error {
  constructor() {
    super('Regola non trovata.')
    this.name = 'RegolaConsorzioNonTrovataError'
  }
}

export class MovimentoNonTrovatoError extends Error {
  constructor() {
    super('Movimento non trovato.')
    this.name = 'MovimentoNonTrovatoError'
  }
}
