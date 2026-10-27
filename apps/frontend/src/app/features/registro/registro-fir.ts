import { FIR, FIRStato } from '../../shared/models/fir.model'
import { formattaQuantita } from '../../shared/format/formatta-quantita'
import { CausaleMovimento, TipoMovimento } from './registro.service'

/** Ruolo della società attiva rispetto alle parti di un FIR. */
export type RuoloFir = 'PRODUTTORE' | 'DESTINATARIO'

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
  ruolo: RuoloFir | null
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

/** Quantità da ricopiare nel registro, con l'eventuale spiegazione per l'utente. */
export interface QuantitaDaFir {
  quantita: number
  unita: string
  suggerimento: string | null
}

/**
 * Quantità da ricopiare nel registro secondo il verso, come RENTRI e WinWaste (C-W-01).
 * CARICO del destinatario con il peso verificato a destino: quel peso, nell'unità del FIR
 * (`confermaConsegna` lo registra nella stessa unità della quantità dichiarata).
 * In ogni altro caso la quantità dichiarata alla partenza: lo SCARICO del produttore riporta
 * sempre quella, e il peso verificato resta sul FIR come esito.
 */
export function quantitaDaFir(
  fir: Pick<FIR, 'rifiuto' | 'pesoEffettivo'>,
  tipo: TipoMovimento,
  ruolo: RuoloFir | null
): QuantitaDaFir {
  const unita = (fir.rifiuto.unitaMisura || 'KG').toUpperCase()
  const dichiarata = fir.rifiuto.quantita
  const peso = fir.pesoEffettivo
  if (tipo === 'CARICO' && ruolo === 'DESTINATARIO' && peso != null && peso > 0) {
    return {
      quantita: peso,
      unita,
      suggerimento:
        `Quantità dal peso verificato a destino (${formattaQuantita(peso)} ${unita}); ` +
        `il FIR dichiarava ${formattaQuantita(dichiarata)} ${unita}.`,
    }
  }
  if (tipo === 'CARICO' && ruolo === 'DESTINATARIO') {
    // Il carico di un FIR non ancora confermato a destino: la dichiarata è un ripiego.
    return {
      quantita: dichiarata,
      unita,
      suggerimento:
        'Il FIR non ha ancora il peso verificato a destino: quantità dichiarata alla partenza ' +
        `(${formattaQuantita(dichiarata)} ${unita}). Se il peso rilevato è diverso, correggila.`,
    }
  }
  return { quantita: dichiarata, unita, suggerimento: null }
}
