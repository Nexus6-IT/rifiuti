/**
 * Porta del servizio O.R.SO. (4.9a): le firme che il controller `/comunicazioni` consuma.
 * L'implementazione e' di `comunicazioni-orso.service.ts` (49-t4); il controller dipende solo da
 * questa interfaccia, via il token `COMUNICAZIONI_ORSO_SERVICE`.
 * Le quantita' sono stringhe decimali col punto.
 */

/** Movimento coinvolto in un avviso, con quanto serve per ritrovarlo nel registro. */
export interface MovimentoAvviso {
  id: string
  /** Giorno `AAAA-MM-GG` del movimento. */
  data: string
  /** Numero progressivo nel registro, «n/anno». */
  numero: string
  /** Le sole cifre del CER. */
  cer: string
}

export interface AvvisoOrso {
  codice: string
  messaggio: string
  movimentoIds: string[]
  movimenti?: MovimentoAvviso[]
}

export interface RigaRicevutoOrso {
  cer: string
  descrizione: string
  operazioni: string[]
  totT: string
  extraT: string
  conFir: boolean
}

export interface RigaProdottoOrso {
  cer: string
  descrizione: string
  operazioni: string[]
  totT: string
  /** Giacenza a fine mese, tonnellate (`QuantitaTrattataInternamente` di O.R.SO.). */
  giacenzaFineMeseT: string
}

export interface MeseOrso {
  /** 1-12 */
  mese: number
  ricevuti: RigaRicevutoOrso[]
  prodotti: RigaProdottoOrso[]
}

export type StatoComunicazione = 'GENERATA' | 'INVIATA'

export interface ComunicazioneVista {
  id: string
  consorzio: string
  unitaLocaleId: string
  periodoDa: string
  periodoA: string
  tracciato: string
  versione: string
  stato: StatoComunicazione
  hashDati: string
  nomeFile: string
  generataIl: string
  generataDa: string
  inviataIl?: string
  inviataDa?: string
  modificataDopoInvio: boolean
}

export interface AnteprimaOrso {
  unitaLocale: { id: string; nome: string; provincia: string | null }
  anno: number
  mesi: MeseOrso[]
  avvisi: AvvisoOrso[]
  bloccanti: boolean
  hashDati: string
  ultima?: ComunicazioneVista
}

export interface FileComunicazione {
  nomeFile: string
  xml: string
}

/** Generazione richiesta con avvisi bloccanti: il controller la traduce in 400. */
export class ComunicazioneConBloccantiError extends Error {
  constructor(readonly avvisi: AvvisoOrso[] = []) {
    super('La comunicazione ha avvisi bloccanti: correggi i movimenti e riprova.')
    this.name = 'ComunicazioneConBloccantiError'
  }
}

/** Comunicazione o sede inesistente (o di un'altra azienda): 404. */
export class ComunicazioneNonTrovataError extends Error {
  constructor() {
    super('Comunicazione non trovata.')
    this.name = 'ComunicazioneNonTrovataError'
  }
}

export interface ComunicazioniOrsoPort {
  anteprima(tenantId: string, unitaLocaleId: string, anno: number): Promise<AnteprimaOrso>
  genera(
    tenantId: string,
    utenteId: string,
    unitaLocaleId: string,
    anno: number
  ): Promise<ComunicazioneVista>
  elenca(
    tenantId: string,
    filtri: { consorzio?: string; unitaLocaleId?: string; anno?: number }
  ): Promise<ComunicazioneVista[]>
  file(tenantId: string, id: string): Promise<FileComunicazione>
  segnaInviata(tenantId: string, utenteId: string, id: string): Promise<ComunicazioneVista>
}

export const COMUNICAZIONI_ORSO_SERVICE = Symbol('COMUNICAZIONI_ORSO_SERVICE')
