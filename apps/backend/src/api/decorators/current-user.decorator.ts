/**
 * Ri-esporta il decoratore canonico di `auth/decorators`: l'utente restituito ha
 * `tenantId` = azienda su cui la richiesta OPERA (selezionata e validata), non quella
 * del token. Una copia separata che restituiva `request.user` cosi' com'e' era una
 * trappola (azienda primaria del token durante uno switch di azienda).
 */
export { CurrentUser } from '../../auth/decorators/current-user.decorator'
export type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
