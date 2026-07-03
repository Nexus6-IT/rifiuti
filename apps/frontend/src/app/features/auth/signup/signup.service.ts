/**
 * AccessRequestService (frontend) — invia il form pubblico "Richiedi accesso".
 *
 * Chiama POST /api/v1/auth/access-request: registra una richiesta di contatto
 * (lead) e notifica il commerciale. NON crea alcun account: la prova guidata
 * (TRIAL) viene attivata manualmente da un consulente.
 */

import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../../environments/environment'

export interface AccessRequestPayload {
  ragioneSociale: string
  partitaIva?: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  message?: string
  privacyAccepted: boolean
}

export interface AccessRequestResponse {
  message: string
  requestId: string
}

@Injectable({ providedIn: 'root' })
export class AccessRequestService {
  private readonly http = inject(HttpClient)
  private readonly apiUrl = environment.apiUrl

  /**
   * Invia la richiesta di accesso al backend.
   * Endpoint pubblico: nessun token JWT richiesto.
   */
  submit(payload: AccessRequestPayload): Observable<AccessRequestResponse> {
    return this.http.post<AccessRequestResponse>(`${this.apiUrl}/auth/access-request`, payload)
  }
}
