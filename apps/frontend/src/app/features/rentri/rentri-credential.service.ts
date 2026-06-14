import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Stato della credenziale RENTRI del tenant (mai segreti). */
export interface RentriCredentialStatus {
  configured: boolean;
  clientId?: string;
  environment?: string;
}

/** Payload PEM diretto. */
export interface SetCredentialPem {
  clientId: string;
  certificatePem: string;
  privateKeyPem: string;
  algorithm?: 'RS256' | 'ES256';
  environment?: string;
}

/** Payload PKCS#12 (.p12/.pfx) in base64 + passphrase. */
export interface SetCredentialPkcs12 {
  clientId: string;
  pkcs12Base64: string;
  pkcs12Passphrase: string;
  algorithm?: 'RS256' | 'ES256';
  environment?: string;
}

/**
 * Client per la gestione del certificato RENTRI del tenant.
 * Backend: api/v1/rentri/credential (solo admin).
 */
@Injectable({ providedIn: 'root' })
export class RentriCredentialService {
  private readonly API_URL = `${environment.apiUrl}/rentri/credential`;

  constructor(private http: HttpClient) {}

  getStatus(): Observable<RentriCredentialStatus> {
    return this.http.get<RentriCredentialStatus>(this.API_URL);
  }

  setCredential(
    payload: SetCredentialPem | SetCredentialPkcs12,
  ): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(this.API_URL, payload);
  }

  remove(): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(this.API_URL);
  }
}
