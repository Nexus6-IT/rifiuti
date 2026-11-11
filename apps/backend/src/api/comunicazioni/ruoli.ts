import type { RuoloApplicativo } from '../me/ruolo-effettivo.service'

/** Generare una comunicazione e segnarla inviata. La lettura e' aperta a ogni ruolo dell'azienda. */
export const RUOLI_OPERATORE_COMUNICAZIONI: readonly RuoloApplicativo[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATOR',
]

/** Gestire le regole dei consorzi e correggere la marcatura di un movimento (4.9b). Lettura: ogni ruolo. */
export const RUOLI_AMMINISTRATORE_COMUNICAZIONI: readonly RuoloApplicativo[] = [
  'SUPER_ADMIN',
  'ADMIN',
]
