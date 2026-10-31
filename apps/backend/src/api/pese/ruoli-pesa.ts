import type { RuoloApplicativo } from '../me/ruolo-effettivo.service'

/** Aprire e chiudere accessi, gestire automezzi, tara da pesata (D10). */
export const RUOLI_OPERATORE_PESA: readonly RuoloApplicativo[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATOR',
]

/** Rettifiche, annullo di un accesso chiuso, tara dichiarata, strumenti (D10, Q2). */
export const RUOLI_RESPONSABILE_PESA: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN']
