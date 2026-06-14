import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Stato del contratto (workflow di approvazione). Allineato al backend. */
export type ContractStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'TERMINATED';

/** Tipo di controparte del contratto. */
export type CounterpartyType = 'TRANSPORTER' | 'DISPOSER' | 'BROKER';

/** Tipo di contratto. */
export type ContractType =
  | 'WASTE_DISPOSAL'
  | 'WASTE_TRANSPORT'
  | 'FULL_SERVICE'
  | 'FRAMEWORK';

/** Modello di pricing del contratto. */
export type PricingModel =
  | 'FLAT_RATE'
  | 'PAY_PER_LIFT'
  | 'PAY_BY_WEIGHT'
  | 'PAY_BY_VOLUME'
  | 'ZONE_BASED'
  | 'TIERED_VOLUME'
  | 'MINIMUM_GUARANTEE'
  | 'HYBRID';

/** Contratto come restituito dal backend (modello Prisma `Contract`). */
export interface Contract {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  contractNumber: string;
  producerId: string;
  counterpartyId: string;
  counterpartyType: CounterpartyType;
  contractType: ContractType;
  description?: string | null;
  cerCodes: string[];
  pricingModel: PricingModel;
  basePrice?: number | string | null;
  unitOfMeasure: string;
  pricingConfig?: unknown;
  startDate: string;
  endDate?: string | null;
  durationMonths?: number | null;
  autoRenew: boolean;
  renewalNoticeDays: number;
  paymentTerms: string;
  billingFrequency: string;
  status: ContractStatus;
}

/** Payload di creazione, allineato a `CreateContractDto` del backend. */
export interface CreateContractDto {
  contractNumber: string;
  producerId: string;
  counterpartyId: string;
  counterpartyType: CounterpartyType;
  contractType: ContractType;
  description?: string;
  cerCodes: string[];
  pricingModel: PricingModel;
  basePrice?: number;
  unitOfMeasure?: string;
  pricingConfig?: unknown;
  startDate: string; // formato ISO date (YYYY-MM-DD)
  endDate?: string;
  durationMonths?: number;
  autoRenew?: boolean;
  renewalNoticeDays?: number;
  paymentTerms?: string;
  billingFrequency?: string;
}

/** Suggerimento di auto-compilazione FIR da contratto attivo. */
export interface FirAutoFill {
  contractId: string;
  contractNumber: string;
  counterpartyId: string;
  counterpartyType: string;
  pricingModel: string;
  basePrice: number | null;
  unitOfMeasure: string;
}

/**
 * Client per la gestione dei contratti produttore↔controparte.
 * Consuma l'API NestJS `contracts` (prefix globale /api/v1 già in apiUrl).
 */
@Injectable({ providedIn: 'root' })
export class ContractsService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = `${environment.apiUrl}/contracts`;

  /** Lista contratti del tenant, con filtro opzionale per stato. */
  list(status?: ContractStatus): Observable<Contract[]> {
    let params = new HttpParams();
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<Contract[]>(this.API_URL, { params });
  }

  /** Dettaglio di un contratto. */
  getById(id: string): Observable<Contract> {
    return this.http.get<Contract>(`${this.API_URL}/${id}`);
  }

  /** Crea un contratto (stato iniziale DRAFT). */
  create(dto: CreateContractDto): Observable<Contract> {
    return this.http.post<Contract>(this.API_URL, dto);
  }

  /** Cambia stato del contratto (workflow di approvazione). */
  updateStatus(id: string, status: ContractStatus): Observable<Contract> {
    return this.http.patch<Contract>(`${this.API_URL}/${id}/status`, { status });
  }

  /** Suggerimento auto-compilazione FIR da contratto attivo (null se nessuno). */
  autoFill(producerId: string, cerCode: string): Observable<FirAutoFill | null> {
    const params = new HttpParams().set('producerId', producerId).set('cerCode', cerCode);
    return this.http.get<FirAutoFill | null>(`${this.API_URL}/auto-fill`, { params });
  }
}
