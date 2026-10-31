import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Stato del contratto (workflow di approvazione). Allineato al backend. */
export type ContractStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'TERMINATED'

/** Tipo di controparte del contratto. */
export type CounterpartyType = 'TRANSPORTER' | 'DISPOSER' | 'BROKER'

/** Tipo di contratto. */
export type ContractType = 'WASTE_DISPOSAL' | 'WASTE_TRANSPORT' | 'FULL_SERVICE' | 'FRAMEWORK'

/** Modello di pricing del contratto. */
export type PricingModel =
  | 'FLAT_RATE'
  | 'PAY_PER_LIFT'
  | 'PAY_BY_WEIGHT'
  | 'PAY_BY_VOLUME'
  | 'ZONE_BASED'
  | 'TIERED_VOLUME'
  | 'MINIMUM_GUARANTEE'
  | 'HYBRID'

/** Campi che la modifica di un contratto può toccare. Allineato al backend (`regole-contratto.ts`). */
export const CAMPI_CONTRATTO = [
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
] as const

export type CampoContratto = (typeof CAMPI_CONTRATTO)[number]

/**
 * Parte del contratto risolta verso il registro anagrafico.
 * `null` sul contratto quando l'id non corrisponde più a un'anagrafica.
 */
export interface ContractParty {
  id: string
  ragioneSociale: string
  /** Null per un privato (solo codice fiscale). */
  partitaIVA: string | null
  codiceFiscale?: string | null
}

/** Contratto come restituito dal backend (modello Prisma `Contract`). */
export interface Contract {
  id: string
  tenantId: string
  createdAt: string
  updatedAt: string
  contractNumber: string
  producerId: string
  counterpartyId: string
  counterpartyType: CounterpartyType
  contractType: ContractType
  description?: string | null
  cerCodes: string[]
  pricingModel: PricingModel
  basePrice?: number | string | null
  unitOfMeasure: string
  pricingConfig?: unknown
  startDate: string
  endDate?: string | null
  durationMonths?: number | null
  autoRenew: boolean
  renewalNoticeDays: number
  paymentTerms: string
  billingFrequency: string
  status: ContractStatus
  /** Lock ottimistico: va rimandata nella modifica e nella cancellazione. */
  versione: number
  /** Campi modificabili nello stato attuale (decide il backend, il frontend non replica le regole). */
  modificabili: CampoContratto[]
  /** Vero se il contratto, nello stato attuale, si può eliminare. */
  eliminabile: boolean
  /** Produttore risolto dal registro; null se l'anagrafica non esiste più. */
  producer?: ContractParty | null
  /** Controparte risolta dal registro; null se l'anagrafica non esiste più. */
  counterparty?: ContractParty | null
}

/** Payload di creazione, allineato a `CreateContractDto` del backend. */
export interface CreateContractDto {
  contractNumber: string
  producerId: string
  counterpartyId: string
  counterpartyType: CounterpartyType
  contractType: ContractType
  description?: string
  cerCodes: string[]
  pricingModel: PricingModel
  basePrice?: number
  unitOfMeasure?: string
  pricingConfig?: unknown
  startDate: string // formato ISO date (YYYY-MM-DD)
  endDate?: string
  durationMonths?: number
  autoRenew?: boolean
  renewalNoticeDays?: number
  paymentTerms?: string
  billingFrequency?: string
}

/**
 * Corpo della modifica (`PATCH /contracts/:id`): solo i campi da cambiare. Assente = invariato,
 * `null` = svuota (consentito dal backend solo sui facoltativi). `versione` è obbligatoria.
 */
export type ModificaContrattoDto = Partial<{
  [K in keyof Omit<CreateContractDto, 'pricingConfig'>]: CreateContractDto[K] | null
}> & { versione: number }

/** Suggerimento di auto-compilazione FIR da contratto attivo. */
export interface FirAutoFill {
  contractId: string
  contractNumber: string
  counterpartyId: string
  counterpartyType: string
  pricingModel: string
  basePrice: number | null
  unitOfMeasure: string
}

/**
 * Client per la gestione dei contratti produttore↔controparte.
 * Consuma l'API NestJS `contracts` (prefix globale /api/v1 già in apiUrl).
 */
@Injectable({ providedIn: 'root' })
export class ContractsService {
  private readonly http = inject(HttpClient)
  private readonly API_URL = `${environment.apiUrl}/contracts`

  /** Lista contratti del tenant, con filtro opzionale per stato. */
  list(status?: ContractStatus): Observable<Contract[]> {
    let params = new HttpParams()
    if (status) {
      params = params.set('status', status)
    }
    return this.http.get<Contract[]>(this.API_URL, { params })
  }

  /** Dettaglio di un contratto. */
  getById(id: string): Observable<Contract> {
    return this.http.get<Contract>(`${this.API_URL}/${id}`)
  }

  /**
   * Prossimo numero contratto suggerito (`CTR-<anno>-<progressivo>`).
   * È un suggerimento per il form: l'unicità è garantita dal DB.
   */
  nextNumber(): Observable<{ contractNumber: string }> {
    return this.http.get<{ contractNumber: string }>(`${this.API_URL}/next-number`)
  }

  /** Crea un contratto (stato iniziale DRAFT). */
  create(dto: CreateContractDto): Observable<Contract> {
    return this.http.post<Contract>(this.API_URL, dto)
  }

  /** Modifica parziale con lock ottimistico (409 se la versione non è più quella letta). */
  update(id: string, dto: ModificaContrattoDto): Observable<Contract> {
    return this.http.patch<Contract>(`${this.API_URL}/${id}`, dto)
  }

  /** Eliminazione logica di un contratto in bozza o in approvazione. */
  elimina(id: string, versione: number): Observable<void> {
    const params = new HttpParams().set('versione', String(versione))
    return this.http.delete<void>(`${this.API_URL}/${id}`, { params })
  }

  /** Cambia stato del contratto (workflow di approvazione). */
  updateStatus(id: string, status: ContractStatus): Observable<Contract> {
    return this.http.patch<Contract>(`${this.API_URL}/${id}/status`, { status })
  }

  /** Suggerimento auto-compilazione FIR da contratto attivo (null se nessuno). */
  autoFill(producerId: string, cerCode: string): Observable<FirAutoFill | null> {
    const params = new HttpParams().set('producerId', producerId).set('cerCode', cerCode)
    return this.http.get<FirAutoFill | null>(`${this.API_URL}/auto-fill`, { params })
  }
}
