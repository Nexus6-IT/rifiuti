import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

// ─── Modelli ────────────────────────────────────────────────────────────────

export type TipoMovimento = 'CARICO' | 'SCARICO'

export const CAUSALI_CARICO = [
  'PRODUZIONE_INTERNA',
  'INGRESSO_ESTERNO',
  'RICLASSIFICAZIONE',
  'RECUPERO_PARZIALE',
  'ALTRO_CARICO',
] as const

export const CAUSALI_SCARICO = [
  'CONFERIMENTO_TRASPORTATORE',
  'AVVIO_RECUPERO',
  'AVVIO_SMALTIMENTO',
  'CESSIONE',
  'RICLASSIFICAZIONE',
  'ALTRO_SCARICO',
] as const

export type CausaleCarico = (typeof CAUSALI_CARICO)[number]
export type CausaleScarico = (typeof CAUSALI_SCARICO)[number]
export type CausaleMovimento = CausaleCarico | CausaleScarico

export interface Movimento {
  id: string
  tenantId: string
  progressiveNumber: number
  progressiveYear: number
  type: TipoMovimento
  movementDate: string
  registrationDate: string
  causale: CausaleMovimento
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  recordedByUserId?: string
  entryHash: string
  notes?: string
  createdAt: string
  fuoriTermine?: boolean
  ritardoGg?: number
}

export interface PaginatedMovimenti {
  items: Movimento[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface RegistraMovimentoRequest {
  type: TipoMovimento
  movementDate: string
  registrationDate?: string
  causale: CausaleMovimento
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit?: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  notes?: string
}

export interface ListMovimentiParams {
  type?: TipoMovimento
  cerCode?: string
  causale?: CausaleMovimento
  dataFrom?: string
  dataTo?: string
  firId?: string
  page?: number
  limit?: number
}

// ─── Etichette ──────────────────────────────────────────────────────────────

export const CAUSALE_LABELS: Record<CausaleMovimento, string> = {
  PRODUZIONE_INTERNA: 'Produzione interna',
  INGRESSO_ESTERNO: 'Ingresso da esterno',
  RICLASSIFICAZIONE: 'Riclassificazione CER',
  RECUPERO_PARZIALE: 'Recupero parziale',
  ALTRO_CARICO: 'Altro carico',
  CONFERIMENTO_TRASPORTATORE: 'Conferimento a trasportatore',
  AVVIO_RECUPERO: 'Avvio a recupero (R)',
  AVVIO_SMALTIMENTO: 'Avvio a smaltimento (D)',
  CESSIONE: 'Cessione a terzi',
  ALTRO_SCARICO: 'Altro scarico',
}

export const STATI_FISICI = ['Solido', 'Liquido', 'Fangoso', 'Gassoso', 'Polvere', 'Misto'] as const

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class RegistroService {
  private readonly API_URL = `${environment.apiUrl}/registro`

  constructor(private readonly http: HttpClient) {}

  /** Registra un nuovo movimento di carico o scarico. */
  registra(dto: RegistraMovimentoRequest): Observable<Movimento> {
    return this.http.post<Movimento>(this.API_URL, dto)
  }

  /** Lista paginata del registro cronologico con filtri opzionali. */
  lista(params: ListMovimentiParams = {}): Observable<PaginatedMovimenti> {
    let httpParams = new HttpParams()
    if (params.type) httpParams = httpParams.set('type', params.type)
    if (params.cerCode) httpParams = httpParams.set('cerCode', params.cerCode)
    if (params.causale) httpParams = httpParams.set('causale', params.causale)
    if (params.dataFrom) httpParams = httpParams.set('dataFrom', params.dataFrom)
    if (params.dataTo) httpParams = httpParams.set('dataTo', params.dataTo)
    if (params.firId) httpParams = httpParams.set('firId', params.firId)
    if (params.page) httpParams = httpParams.set('page', params.page.toString())
    if (params.limit) httpParams = httpParams.set('limit', params.limit.toString())
    return this.http.get<PaginatedMovimenti>(this.API_URL, { params: httpParams })
  }
}
