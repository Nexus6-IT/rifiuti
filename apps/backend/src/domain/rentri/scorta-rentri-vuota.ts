import { DomainException } from '../shared/domain-exception'

/** Codice macchina dell'emissione rifiutata perche' la scorta vidimata e' esaurita. */
export const CODICE_SCORTA_RENTRI_VUOTA = 'SCORTA_RENTRI_VUOTA'

/** Messaggio unico, usato dal consumo standalone e da quello dentro l'emissione. */
export const MESSAGGIO_SCORTA_RENTRI_VUOTA =
  'Nessun numero FIR RENTRI pre-vidimato disponibile: vidima un lotto dalla sezione Blocchi ' +
  'RENTRI o attendi il rifornimento automatico prima di emettere.'

/** Scorta vidimata esaurita: fail-closed, mai un numero inventato. */
export function scortaRentriVuota(): DomainException {
  return DomainException.businessRuleViolation(
    CODICE_SCORTA_RENTRI_VUOTA,
    MESSAGGIO_SCORTA_RENTRI_VUOTA
  )
}

/** Vero se l'errore e' quello della scorta esaurita. */
export function eScortaRentriVuota(errore: unknown): errore is DomainException {
  return errore instanceof DomainException && errore.metadata?.rule === CODICE_SCORTA_RENTRI_VUOTA
}
