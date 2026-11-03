// Ruoli ammessi sulle rotte dei legami movimento (4.3): lettura a tutti i ruoli, scrittura a
// SUPER_ADMIN/ADMIN/OPERATOR; le impostazioni e le variazioni di prezzo sono riservate agli
// amministratori (spec §9).
import { RUOLI_VARIAZIONI } from '../listino/ruoli'
export { RUOLI_LETTURA, RUOLI_SCRITTURA } from '../listino/ruoli'
export const RUOLI_AMMINISTRATORI = RUOLI_VARIAZIONI
