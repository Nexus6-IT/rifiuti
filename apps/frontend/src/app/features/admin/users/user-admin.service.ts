import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Ruoli applicativi, allineati all'enum del backend. */
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

/** Utente come restituito dal backend (`GET /admin/users`). */
export interface AdminUser {
  id: string;
  tenantId: string;
  keycloakId: string;
  fiscalCode: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  /** Stato abilitazione su Keycloak; può non essere sempre presente. */
  enabled?: boolean;
  createdAt: string;
}

/** Payload di creazione utente (`POST /admin/users`). */
export interface CreateUserDto {
  fiscalCode: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  /** Obbligatorio per SUPER_ADMIN, ignorato/forzato per ADMIN. */
  tenantId?: string;
  /** Password temporanea (min 8); l'utente la cambia al primo accesso. */
  tempPassword?: string;
}

/** Tenant minimale per il selettore (`GET /admin/tenants`). */
export interface TenantOption {
  id: string;
  ragioneSociale: string;
}

/**
 * Client per la gestione utenti (area amministrazione).
 * Consuma l'API NestJS `admin` (prefix globale /api/v1 già in apiUrl).
 */
@Injectable({ providedIn: 'root' })
export class UserAdminService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = `${environment.apiUrl}/admin`;

  /**
   * Lista utenti.
   * - SUPER_ADMIN: tutti, oppure filtrati per `tenantId`.
   * - ADMIN: il backend forza il proprio tenant (parametro ignorato).
   */
  list(tenantId?: string): Observable<AdminUser[]> {
    let params = new HttpParams();
    if (tenantId) {
      params = params.set('tenantId', tenantId);
    }
    return this.http.get<AdminUser[]>(`${this.API_URL}/users`, { params });
  }

  /** Crea un utente su Keycloak + DB. */
  create(dto: CreateUserDto): Observable<AdminUser> {
    return this.http.post<AdminUser>(`${this.API_URL}/users`, dto);
  }

  /** Cambia il ruolo applicativo dell'utente. */
  updateRole(id: string, role: UserRole): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.API_URL}/users/${id}/role`, { role });
  }

  /** Abilita/disabilita l'utente (su Keycloak). */
  setStatus(id: string, enabled: boolean): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.API_URL}/users/${id}/status`, { enabled });
  }

  /** Lista tenant per i selettori (solo SUPER_ADMIN). */
  listTenants(): Observable<TenantOption[]> {
    return this.http.get<TenantOption[]>(`${this.API_URL}/tenants`);
  }
}
