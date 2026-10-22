import { FIR, FIRStato } from '../../shared/models/fir.model'

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
