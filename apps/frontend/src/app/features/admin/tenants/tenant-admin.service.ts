import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Livello di abbonamento del tenant. Allineato al backend. */
export type SubscriptionTier = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | string;

/** Stato dell'abbonamento del tenant. */
export type SubscriptionStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | string;

/** Tenant come restituito dal backend (modello Prisma `Tenant`). */
export interface Tenant {
  id: string;
  partitaIva: string;
  ragioneSociale: string;
  codiceFiscale?: string | null;
  pec?: string | null;
  telefono?: string | null;
  atecoCode?: string | null;
  address: string;
  civico?: string | null;
  city: string;
  province: string;
  postalCode: string;
  country?: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  firLimitPerMonth: number;
  userLimitTotal: number;
  createdAt: string;
  _count?: {
    users: number;
  };
}

/** Payload di creazione tenant. Allineato a `CreateTenantDto` del backend. */
export interface CreateTenantDto {
  partitaIva: string;
  ragioneSociale: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  codiceFiscale?: string;
  pec?: string;
  telefono?: string;
  atecoCode?: string;
  civico?: string;
  country?: string;
  subscriptionTier?: SubscriptionTier;
  subscriptionStatus?: SubscriptionStatus;
  firLimitPerMonth?: number;
  userLimitTotal?: number;
}

/** Payload di aggiornamento parziale (partitaIva non modificabile). */
export type UpdateTenantDto = Partial<Omit<CreateTenantDto, 'partitaIva'>>;

/**
 * Client per l'amministrazione dei tenant (solo SUPER_ADMIN).
 * Consuma l'API NestJS `admin/tenants` (prefix globale /api/v1 già in apiUrl).
 */
@Injectable({ providedIn: 'root' })
export class TenantAdminService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = `${environment.apiUrl}/admin/tenants`;

  /** Elenco di tutti i tenant, con conteggio utenti. */
  list(): Observable<Tenant[]> {
    return this.http.get<Tenant[]>(this.API_URL);
  }

  /** Dettaglio di un tenant. */
  get(id: string): Observable<Tenant> {
    return this.http.get<Tenant>(`${this.API_URL}/${id}`);
  }

  /** Crea un nuovo tenant (409 se partitaIva duplicata). */
  create(dto: CreateTenantDto): Observable<Tenant> {
    return this.http.post<Tenant>(this.API_URL, dto);
  }

  /** Aggiorna parzialmente un tenant (partitaIva non modificabile). */
  update(id: string, dto: UpdateTenantDto): Observable<Tenant> {
    return this.http.put<Tenant>(`${this.API_URL}/${id}`, dto);
  }

  /** Sospende o riattiva un tenant. */
  setStatus(id: string, status: 'SUSPENDED' | 'ACTIVE'): Observable<Tenant> {
    return this.http.patch<Tenant>(`${this.API_URL}/${id}/status`, { status });
  }
}
