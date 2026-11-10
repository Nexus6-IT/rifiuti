import type { RuoloApplicativo } from '../me/ruolo-effettivo.service'

/** Generare una comunicazione e segnarla inviata. La lettura e' aperta a ogni ruolo dell'azienda. */
export const RUOLI_OPERATORE_COMUNICAZIONI: readonly RuoloApplicativo[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATOR',
]
