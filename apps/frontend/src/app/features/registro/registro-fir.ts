import { FIR, FIRStato } from '../../shared/models/fir.model'
import { CausaleMovimento } from './registro.service'

/** Data dell'operazione ricavata da un FIR, o il motivo per cui non si può ricavare. */
export interface DataDaFir {
  data: Date | null
  suggerimento: string | null
}

export const SUGGERIMENTO_SENZA_PRESA_IN_CARICO =
  'WasteFlow non conosce la data di presa in carico di questo FIR (non registrata qui, o avvenuta su RENTRI): inserisci la data del trasporto riportata sul formulario.'

export const SUGGERIMENTO_SENZA_ARRIVO =
  'WasteFlow non conosce la data di arrivo di questo FIR: inserisci la data in cui il rifiuto è stato ricevuto.'

/**
 * Data dell'operazione da ricopiare nel registro, solo se WasteFlow la conosce davvero.
 * SCARICO (l'azienda è produttore): la presa in carico registrata in WasteFlow.
 * CARICO (l'azienda è destinataria): la data di arrivo.
 * Mai `dataPresaCarico`: è la colonna `transport_date`, che per un FIR non preso in
 * carico in WasteFlow contiene un ripiego.
 */
export function dataOperazioneDaFir(
  fir: Pick<FIR, 'dataPresaCaricoEffettiva' | 'dataConsegna'>,
  tipo: 'CARICO' | 'SCARICO'
): DataDaFir {
  if (tipo === 'SCARICO') {
    return fir.dataPresaCaricoEffettiva
      ? { data: new Date(fir.dataPresaCaricoEffettiva), suggerimento: null }
      : { data: null, suggerimento: SUGGERIMENTO_SENZA_PRESA_IN_CARICO }
  }
  return fir.dataConsegna
    ? { data: new Date(fir.dataConsegna), suggerimento: null }
    : { data: null, suggerimento: SUGGERIMENTO_SENZA_ARRIVO }
}

/**
 * Causale proposta per la ricopia di un FIR. Con il ruolo della società non riconosciuto
 * (Decisione 13) non se ne propone nessuna: la sceglie l'utente.
 */
export function causalePredefinitaDaFir(
  tipo: 'CARICO' | 'SCARICO',
  ruolo: 'PRODUTTORE' | 'DESTINATARIO' | null
): CausaleMovimento | null {
  if (ruolo === null) return null
  return tipo === 'SCARICO' ? 'CONFERIMENTO_TRASPORTATORE' : 'INGRESSO_ESTERNO'
}

/**
 * Un movimento del registro si collega solo a un FIR emesso, oppure a una bozza che ha
 * già un numero RENTRI, e mai a un FIR annullato (in locale o all'ente).
 * Rispecchia `domain/fir/stati-fir.ts` del backend, che resta l'arbitro.
 */
export function firCollegabileNelRegistro(
  fir: Pick<FIR, 'stato' | 'rentriNumeroFir' | 'rentriStatoFormulario'>
): boolean {
  if (fir.stato === FIRStato.ANNULLATO || fir.rentriStatoFormulario === 'Annullato') return false
  if (
    fir.stato === FIRStato.EMESSO ||
    fir.stato === FIRStato.IN_TRANSITO ||
    fir.stato === FIRStato.CONSEGNATO
  ) {
    return true
  }
  if (fir.stato === FIRStato.BOZZA) return !!fir.rentriNumeroFir?.trim()
  return false
}
