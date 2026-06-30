/**
 * SignupService (frontend) — chiama POST /api/v1/auth/signup per la
 * registrazione self-service di una nuova azienda (WS-G).
 */

import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../../environments/environment'

export interface SignupPayload {
  ragioneSociale: string
  partitaIva: string
  firstName: string
  lastName: string
  email: string
  fiscalCode: string
  tosAccepted: boolean
  privacyAccepted: boolean
}

export interface SignupResponse {
  message: string
  tenantId: string
}

@Injectable({ providedIn: 'root' })
export class SignupService {
  private readonly http = inject(HttpClient)
  private readonly apiUrl = environment.apiUrl

  /**
   * Invia la richiesta di registrazione al backend.
   * Endpoint pubblico: nessun token JWT richiesto.
   */
  register(payload: SignupPayload): Observable<SignupResponse> {
    return this.http.post<SignupResponse>(`${this.apiUrl}/auth/signup`, payload)
  }
}
