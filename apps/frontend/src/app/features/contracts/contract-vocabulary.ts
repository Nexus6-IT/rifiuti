/**
 * Etichette italiane dei vocabolari del contratto.
 *
 * I valori (chiavi) sono i codici tecnici salvati a DB; le etichette sono ciò
 * che vede l'operatore. Gemello di
 * `apps/backend/src/application/contracts/contract-vocabulary.ts`, che elenca i
 * codici ammessi in scrittura: l'allineamento fra i due file è verificato da un
 * test lato backend.
 *
 * In lettura si resta permissivi: i contratti creati prima che questi elenchi
 * esistessero possono contenere altri valori, e vanno comunque mostrati.
 */

import { ContractStatus, ContractType, CounterpartyType, PricingModel } from './contracts.service'

export interface SelectOption<T> {
  label: string
  value: T
}

export const PAYMENT_TERM_LABELS: Record<string, string> = {
  immediato: 'Pagamento immediato',
  net_30: '30 giorni data fattura',
  net_60: '60 giorni data fattura',
  net_90: '90 giorni data fattura',
  net_30_fm: '30 giorni fine mese',
  net_60_fm: '60 giorni fine mese',
}

export const BILLING_FREQUENCY_LABELS: Record<string, string> = {
  per_trip: 'A viaggio',
  weekly: 'Settimanale',
  monthly: 'Mensile',
  bimonthly: 'Bimestrale',
  quarterly: 'Trimestrale',
  biannual: 'Semestrale',
  annual: 'Annuale',
  on_completion: 'A fine servizio',
}

export const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Bozza',
  PENDING_APPROVAL: 'In approvazione',
  ACTIVE: 'Attivo',
  SUSPENDED: 'Sospeso',
  EXPIRED: 'Scaduto',
  TERMINATED: 'Risolto',
}

export const TYPE_LABELS: Record<ContractType, string> = {
  WASTE_DISPOSAL: 'Smaltimento',
  WASTE_TRANSPORT: 'Trasporto',
  FULL_SERVICE: 'Servizio completo',
  FRAMEWORK: 'Accordo quadro',
}

export const COUNTERPARTY_LABELS: Record<CounterpartyType, string> = {
  TRANSPORTER: 'Trasportatore',
  DISPOSER: 'Destinatario',
  BROKER: 'Intermediario',
}

export const PRICING_LABELS: Record<PricingModel, string> = {
  FLAT_RATE: 'Tariffa fissa',
  PAY_PER_LIFT: 'A svuotamento',
  PAY_BY_WEIGHT: 'A peso',
  PAY_BY_VOLUME: 'A volume',
  ZONE_BASED: 'Per zona',
  TIERED_VOLUME: 'Volume a scaglioni',
  MINIMUM_GUARANTEE: 'Garanzia minima',
  HYBRID: 'Ibrido',
}

/** Registro anagrafico da cui pescare la controparte. */
export type RegistroControparte = 'trasportatori' | 'destinatari'

/**
 * Registro implicato dal tipo di contratto.
 *
 * `FULL_SERVICE` e `FRAMEWORK` non ne implicano uno solo: restituiscono null e
 * la UI chiede all'operatore di scegliere il tipo di controparte.
 */
export function registroDaTipoContratto(tipo: ContractType | null): RegistroControparte | null {
  switch (tipo) {
    case 'WASTE_TRANSPORT':
      return 'trasportatori'
    case 'WASTE_DISPOSAL':
      return 'destinatari'
    default:
      return null
  }
}

/** Tipo di controparte salvato a DB per un dato registro. */
export function tipoControparteDaRegistro(registro: RegistroControparte): CounterpartyType {
  return registro === 'trasportatori' ? 'TRANSPORTER' : 'DISPOSER'
}

/** Etichetta di un codice, o il codice stesso se sconosciuto (dati storici). */
export function etichetta(
  mappa: Record<string, string>,
  codice: string | null | undefined
): string {
  if (!codice) return '—'
  return mappa[codice] ?? codice
}

/** Trasforma una mappa codice→etichetta in opzioni per una p-dropdown. */
export function opzioni(mappa: Record<string, string>): SelectOption<string>[] {
  return Object.entries(mappa).map(([value, label]) => ({ label, value }))
}
