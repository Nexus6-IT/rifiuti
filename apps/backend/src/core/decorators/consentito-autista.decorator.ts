import { SetMetadata } from '@nestjs/common'

export const CONSENTITO_AUTISTA = 'consentitoAutista'

/**
 * La rotta (o tutta la classe) e' raggiungibile da un utente con ruolo `AUTISTA` (app campo).
 *
 * Fail-closed: `RuoloAutistaInterceptor` respinge con 403 OGNI rotta che non porta questo
 * marcatore. Una rotta d'ufficio nuova resta quindi chiusa all'autista senza che nessuno debba
 * ricordarsene; il marcatore va messo solo dove l'autista deve entrare. Il motivo e' obbligatorio
 * e resta nel codice, non nella risposta. L'elenco ammesso e' fissato da
 * `ruolo-autista.interceptor.spec.ts`: aggiungere una rotta ammessa richiede di aggiornarlo.
 */
export const ConsentitoAutista = (motivo: string) => SetMetadata(CONSENTITO_AUTISTA, motivo)
