import type { StatoRitiro, StatoVisibileRitiro } from './tipi'

/** Stati del FIR nel database (`FIRStatus`). */
export type StatoFirDb =
  | 'DRAFT'
  | 'AWAITING_PRODUCER'
  | 'AWAITING_CARRIER'
  | 'AWAITING_RECEIVER'
  | 'COMPLETED'
  | 'SYNCED_TO_RENTRI'
  | 'CANCELLED'

const DA_STATO_FIR: Record<StatoFirDb, StatoVisibileRitiro> = {
  DRAFT: 'FIR_BOZZA',
  AWAITING_PRODUCER: 'FIR_BOZZA',
  AWAITING_CARRIER: 'FIR_EMESSO',
  AWAITING_RECEIVER: 'IN_TRASPORTO',
  COMPLETED: 'CONSEGNATO',
  SYNCED_TO_RENTRI: 'CONSEGNATO',
  // un FIR annullato non è "attivo": il ritiro torna da generare
  CANCELLED: 'DA_GENERARE',
}

/**
 * Stato visibile del ritiro (P7 §3.5): ANNULLATO e NON_ESEGUITO dalla colonna, altrimenti dal
 * FIR attivo. Annullare un FIR non tocca mai la tabella dei ritiri.
 * `statoFirAttivo` è null/undefined se il ritiro non ha un FIR attivo.
 */
export function statoVisibile(
  stato: StatoRitiro,
  statoFirAttivo: StatoFirDb | null | undefined
): StatoVisibileRitiro {
  if (stato === 'ANNULLATO') return 'ANNULLATO'
  if (stato === 'NON_ESEGUITO') return 'NON_ESEGUITO'
  if (statoFirAttivo == null) return 'DA_GENERARE'
  const visibile = DA_STATO_FIR[statoFirAttivo]
  if (visibile === undefined) {
    throw new Error(`Stato FIR sconosciuto: ${String(statoFirAttivo)}`)
  }
  return visibile
}
