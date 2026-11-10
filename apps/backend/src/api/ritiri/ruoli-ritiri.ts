import type { RuoloApplicativo } from '../me/ruolo-effettivo.service'

/** Scrittura sui ritiri e generazione dei FIR (P7 §5); la lettura e' di tutti i ruoli dell'azienda. */
export const RUOLI_SCRITTURA_RITIRI: readonly RuoloApplicativo[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATOR',
]
