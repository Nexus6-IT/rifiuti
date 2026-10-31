/**
 * Regole pure del contratto produttore↔controparte (Fase 4 pezzo 0, piano
 * docs/superpowers/plans/2026-10-31-fase4-0-contratto-modifica-cancellazione.md).
 *
 * Decide, senza Nest né Prisma, cosa si può fare a un contratto in un dato stato:
 *  - D2: DRAFT modifica tutti i 17 campi; ACTIVE e SUSPENDED solo i termini (descrizione, CER,
 *    prezzo, unità, fine, durata, rinnovo, preavviso, pagamento, fatturazione), mai "chi e cosa"
 *    (numero, parti, tipo, inizio); PENDING_APPROVAL, EXPIRED e TERMINATED nessuno.
 *    Si eliminano solo DRAFT e PENDING_APPROVAL.
 *  - D4: modifica parziale, campo assente = invariato, `null` svuota solo i campi facoltativi.
 *  - D5: confronto sui valori normalizzati (date per getTime, prezzo come numero, CER come
 *    insieme ordinato senza duplicati, stringhe con trim, descrizione vuota = null).
 *  - D6: validazione condivisa da creazione e modifica.
 *
 * `pricingConfig` (scritto e mai letto) e `status` (si cambia con PATCH :id/status) non sono
 * campi della modifica. Il contratto cliente di 4.1 sarà un modello separato (D13): non dipende
 * da questo file.
 */

export type ContractStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'TERMINATED'

export type CampoContratto =
  | 'contractNumber'
  | 'producerId'
  | 'counterpartyId'
  | 'counterpartyType'
  | 'contractType'
  | 'description'
  | 'cerCodes'
  | 'pricingModel'
  | 'basePrice'
  | 'unitOfMeasure'
  | 'startDate'
  | 'endDate'
  | 'durationMonths'
  | 'autoRenew'
  | 'renewalNoticeDays'
  | 'paymentTerms'
  | 'billingFrequency'

/** Valori normalizzati (D5). */
export interface DatiContratto {
  contractNumber: string
  producerId: string
  counterpartyId: string
  counterpartyType: 'TRANSPORTER' | 'DISPOSER' | 'BROKER'
  contractType: 'WASTE_DISPOSAL' | 'WASTE_TRANSPORT' | 'FULL_SERVICE' | 'FRAMEWORK'
  description: string | null
  cerCodes: string[]
  pricingModel: string
  basePrice: number | null
  unitOfMeasure: string
  startDate: Date
  endDate: Date | null
  durationMonths: number | null
  autoRenew: boolean
  renewalNoticeDays: number
  paymentTerms: string
  billingFrequency: string
}

export type ModificaContratto = { [K in CampoContratto]?: DatiContratto[K] | null }

/** Ordine canonico dei campi (anche dei messaggi). */
const ORDINE_CAMPI: readonly CampoContratto[] = [
  'contractNumber',
  'producerId',
  'counterpartyId',
  'counterpartyType',
  'contractType',
  'description',
  'cerCodes',
  'pricingModel',
  'basePrice',
  'unitOfMeasure',
  'startDate',
  'endDate',
  'durationMonths',
  'autoRenew',
  'renewalNoticeDays',
  'paymentTerms',
  'billingFrequency',
]

export const ETICHETTE_CAMPI: Readonly<Record<CampoContratto, string>> = {
  contractNumber: 'Numero',
  producerId: 'Produttore',
  counterpartyId: 'Controparte',
  counterpartyType: 'Tipo controparte',
  contractType: 'Tipo di contratto',
  description: 'Descrizione',
  cerCodes: 'Codici CER',
  pricingModel: 'Modello di prezzo',
  basePrice: 'Prezzo base',
  unitOfMeasure: 'Unità di misura',
  startDate: 'Data di inizio',
  endDate: 'Data di fine',
  durationMonths: 'Durata in mesi',
  autoRenew: 'Rinnovo automatico',
  renewalNoticeDays: 'Giorni di preavviso',
  paymentTerms: 'Termini di pagamento',
  billingFrequency: 'Frequenza di fatturazione',
}

/** "<Etichetta> è obbligatorio.", con accordo di genere e numero (testo visibile al cliente). */
export const MESSAGGI_OBBLIGATORIO: Readonly<Record<CampoContratto, string>> = {
  contractNumber: 'Numero è obbligatorio.',
  producerId: 'Produttore è obbligatorio.',
  counterpartyId: 'Controparte è obbligatoria.',
  counterpartyType: 'Tipo controparte è obbligatorio.',
  contractType: 'Tipo di contratto è obbligatorio.',
  description: 'Descrizione è obbligatoria.',
  cerCodes: 'Codici CER sono obbligatori.',
  pricingModel: 'Modello di prezzo è obbligatorio.',
  basePrice: 'Prezzo base è obbligatorio.',
  unitOfMeasure: 'Unità di misura è obbligatoria.',
  startDate: 'Data di inizio è obbligatoria.',
  endDate: 'Data di fine è obbligatoria.',
  durationMonths: 'Durata in mesi è obbligatoria.',
  autoRenew: 'Rinnovo automatico è obbligatorio.',
  renewalNoticeDays: 'Giorni di preavviso sono obbligatori.',
  paymentTerms: 'Termini di pagamento sono obbligatori.',
  billingFrequency: 'Frequenza di fatturazione è obbligatoria.',
}

const TERMINI: readonly CampoContratto[] = [
  'description',
  'cerCodes',
  'pricingModel',
  'basePrice',
  'unitOfMeasure',
  'endDate',
  'durationMonths',
  'autoRenew',
  'renewalNoticeDays',
  'paymentTerms',
  'billingFrequency',
]

export const CAMPI_MODIFICABILI: Readonly<Record<ContractStatus, readonly CampoContratto[]>> = {
  DRAFT: ORDINE_CAMPI,
  PENDING_APPROVAL: [],
  ACTIVE: TERMINI,
  SUSPENDED: TERMINI,
  EXPIRED: [],
  TERMINATED: [],
}

export const STATI_ELIMINABILI: readonly ContractStatus[] = ['DRAFT', 'PENDING_APPROVAL']

export const CAMPI_FACOLTATIVI: readonly CampoContratto[] = [
  'description',
  'basePrice',
  'endDate',
  'durationMonths',
]

/** Contratto grezzo (Prisma): il Decimal si riceve come `{ toNumber(): number }`. */
export interface ContrattoGrezzo {
  contractNumber: string
  producerId: string
  counterpartyId: string
  counterpartyType: string
  contractType: string
  description: string | null
  cerCodes: string[]
  pricingModel: string
  basePrice: { toNumber(): number } | number | null
  unitOfMeasure: string
  startDate: Date
  endDate: Date | null
  durationMonths: number | null
  autoRenew: boolean
  renewalNoticeDays: number
  paymentTerms: string
  billingFrequency: string
}

function normalizzaCer(cer: readonly string[]): string[] {
  return [...new Set(cer.map(c => c.trim()))].sort()
}

export function normalizzaDati(g: ContrattoGrezzo): DatiContratto {
  const descrizione = g.description === null ? null : g.description.trim()
  return {
    contractNumber: g.contractNumber.trim(),
    producerId: g.producerId,
    counterpartyId: g.counterpartyId,
    counterpartyType: g.counterpartyType as DatiContratto['counterpartyType'],
    contractType: g.contractType as DatiContratto['contractType'],
    description: descrizione === '' ? null : descrizione,
    cerCodes: normalizzaCer(g.cerCodes),
    pricingModel: g.pricingModel,
    basePrice:
      g.basePrice === null
        ? null
        : typeof g.basePrice === 'number'
          ? g.basePrice
          : g.basePrice.toNumber(),
    unitOfMeasure: g.unitOfMeasure.trim(),
    startDate: g.startDate,
    endDate: g.endDate,
    durationMonths: g.durationMonths,
    autoRenew: g.autoRenew,
    renewalNoticeDays: g.renewalNoticeDays,
    paymentTerms: g.paymentTerms,
    billingFrequency: g.billingFrequency,
  }
}

export function validaDatiContratto(d: DatiContratto): string[] {
  const m: string[] = []
  if (d.contractNumber.trim() === '') m.push(MESSAGGI_OBBLIGATORIO.contractNumber)
  else if (d.contractNumber.length > 50) m.push('Il numero non può superare 50 caratteri.')
  if (d.cerCodes.length === 0) m.push('Indica almeno un codice CER.')
  for (const cer of d.cerCodes) if (!/^\d{6}$/.test(cer)) m.push(`Codice CER non valido: ${cer}.`)
  if (d.basePrice !== null && !(d.basePrice >= 0)) m.push('Il prezzo base non può essere negativo.')
  if (d.unitOfMeasure === '') m.push(MESSAGGI_OBBLIGATORIO.unitOfMeasure)
  else if (d.unitOfMeasure.length > 10) m.push("L'unità di misura non può superare 10 caratteri.")
  if (d.endDate !== null && d.endDate.getTime() < d.startDate.getTime())
    m.push('La data di fine non può precedere la data di inizio.')
  if (d.durationMonths !== null && !(Number.isInteger(d.durationMonths) && d.durationMonths >= 1))
    m.push('La durata deve essere un numero intero di mesi, almeno 1.')
  if (!(Number.isInteger(d.renewalNoticeDays) && d.renewalNoticeDays >= 0))
    m.push('I giorni di preavviso devono essere un numero intero, non negativo.')
  return m
}

export function motivoNonModificabile(stato: ContractStatus): string | null {
  switch (stato) {
    case 'PENDING_APPROVAL':
      return 'Un contratto in approvazione non si modifica: riportalo in bozza per correggerlo.'
    case 'EXPIRED':
      return 'Un contratto scaduto non si modifica.'
    case 'TERMINATED':
      return 'Un contratto cessato non si modifica.'
    default:
      return null
  }
}

export function motivoNonEliminabile(stato: ContractStatus): string | null {
  return STATI_ELIMINABILI.includes(stato)
    ? null
    : 'Si eliminano solo i contratti in bozza o in approvazione: per chiudere questo contratto portalo in stato Cessato.'
}

function uguali(campo: CampoContratto, a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (campo === 'cerCodes') {
    const x = a as string[]
    const y = b as string[]
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  return a === b
}

export type PianoModifica =
  | { esito: 'NESSUNA_MODIFICA' }
  | { esito: 'CAMPI_NON_AMMESSI'; campi: CampoContratto[]; messaggio: string }
  | { esito: 'NON_VALIDA'; messaggi: string[] }
  | { esito: 'OK'; dopo: DatiContratto; cambiati: CampoContratto[] }

export function pianificaModifica(
  stato: ContractStatus,
  attuale: DatiContratto,
  modifica: ModificaContratto
): PianoModifica {
  const dopo: Record<string, unknown> = { ...attuale }
  const obbligatori: string[] = []
  for (const campo of ORDINE_CAMPI) {
    if (!(campo in modifica) || modifica[campo] === undefined) continue
    const v = modifica[campo]
    if (v === null) {
      if (CAMPI_FACOLTATIVI.includes(campo)) dopo[campo] = null
      else obbligatori.push(MESSAGGI_OBBLIGATORIO[campo])
      continue
    }
    if (campo === 'cerCodes') dopo[campo] = normalizzaCer(v as string[])
    else if (typeof v === 'string' && ['contractNumber', 'unitOfMeasure'].includes(campo))
      dopo[campo] = v.trim()
    else if (campo === 'description') {
      const t = (v as string).trim()
      dopo[campo] = t === '' ? null : t
    } else dopo[campo] = v
  }
  if (obbligatori.length > 0) return { esito: 'NON_VALIDA', messaggi: obbligatori }

  const cambiati = ORDINE_CAMPI.filter(c => !uguali(c, attuale[c], dopo[c]))
  if (cambiati.length === 0) return { esito: 'NESSUNA_MODIFICA' }

  const ammessi = CAMPI_MODIFICABILI[stato]
  const nonAmmessi = cambiati.filter(c => !ammessi.includes(c))
  if (nonAmmessi.length > 0) {
    return {
      esito: 'CAMPI_NON_AMMESSI',
      campi: nonAmmessi,
      messaggio: `In un contratto attivo o sospeso non si possono cambiare: ${nonAmmessi
        .map(c => ETICHETTE_CAMPI[c])
        .join(', ')}.`,
    }
  }

  const risultato = dopo as unknown as DatiContratto
  const messaggi = validaDatiContratto(risultato)
  if (messaggi.length > 0) return { esito: 'NON_VALIDA', messaggi }
  return { esito: 'OK', dopo: risultato, cambiati }
}
