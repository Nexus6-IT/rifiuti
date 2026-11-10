/**
 * Tipi del dominio dei ritiri programmati (4.7): modulo puro, senza Prisma né Nest.
 * I valori delle enum coincidono con quelle del database (`StatoRitiro`, `FasciaRitiro`).
 */

export const STATI_RITIRO = ['PROGRAMMATO', 'NON_ESEGUITO', 'ANNULLATO'] as const
export type StatoRitiro = (typeof STATI_RITIRO)[number]

export const FASCE_RITIRO = ['MATTINA', 'POMERIGGIO'] as const
export type FasciaRitiro = (typeof FASCE_RITIRO)[number]

/** Stato visibile all'utente: ricavato, mai salvato (P7 §3.5). */
export type StatoVisibileRitiro =
  | 'ANNULLATO'
  | 'NON_ESEGUITO'
  | 'DA_GENERARE'
  | 'FIR_BOZZA'
  | 'FIR_EMESSO'
  | 'IN_TRASPORTO'
  | 'CONSEGNATO'

/** Massimo di occorrenze di una ripetizione (D2). */
export const MAX_OCCORRENZE_RIPETIZIONE = 52
