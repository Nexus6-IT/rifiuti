/**
 * Vocabolari dei termini commerciali del contratto.
 *
 * I valori qui elencati sono i codici salvati a DB (colonne `payment_terms` e
 * `billing_frequency`, entrambe VarChar(20)). Le etichette italiane mostrate
 * all'operatore vivono nel gemello frontend
 * `apps/frontend/src/app/features/contracts/contract-vocabulary.ts`: il repo non
 * ha ancora librerie condivise, quindi l'allineamento fra i due file è
 * verificato da un test, non garantito dal compilatore.
 *
 * I contratti già a DB possono contenere valori fuori da questi elenchi: il
 * vincolo si applica solo alle scritture nuove, la lettura resta permissiva.
 */

export const PAYMENT_TERMS = [
  'immediato',
  'net_30',
  'net_60',
  'net_90',
  'net_30_fm',
  'net_60_fm',
] as const

export const BILLING_FREQUENCIES = [
  'per_trip',
  'weekly',
  'monthly',
  'bimonthly',
  'quarterly',
  'biannual',
  'annual',
  'on_completion',
] as const

export type PaymentTerm = (typeof PAYMENT_TERMS)[number]
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number]
