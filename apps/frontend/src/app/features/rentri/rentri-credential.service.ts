import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/**
 * Stato della credenziale RENTRI del tenant (mai segreti).
 *
 * `numIscrSito` (deprecato, R2 multi-sede): non più gestito da questa
 * pagina/servizio — le sedi RENTRI del tenant si gestiscono a parte (vedi
 * RentriUnitaLocaleService, pagina /rentri/sedi). Il campo può ancora
 * arrivare dal backend per compatibilità col dato storico, ma non viene più
 * letto né scritto qui.
 */
export interface RentriCredentialStatus {
  configured: boolean
  clientId?: string
  environment?: string
  /**
   * Numero di iscrizione dell'operatore (R4 Task 3): serve come parametro di
   * path per leggere le unità locali dall'ente (`GET /operatore/{num_iscr}/siti`).
   * Senza questo valore la sezione «Unità locali» dell'area RENTRI (Task 7
   * Step 1) non può interrogare l'ente e deve dirlo, non mostrare una
   * tabella vuota silenziosa.
   */
  numIscrOperatore?: string | null
  /** Algoritmo di firma ricavato dalla chiave del certificato (sola lettura). */
  algorithm?: 'RS256' | 'ES256'
}

/** Payload PEM diretto. */
export interface SetCredentialPem {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  environment?: string
}

/** Payload PKCS#12 (.p12/.pfx) in base64 + passphrase. */
export interface SetCredentialPkcs12 {
  clientId: string
  pkcs12Base64: string
  pkcs12Passphrase: string
  environment?: string
}

/**
 * Client per la gestione del certificato RENTRI del tenant.
 * Backend: api/v1/rentri/credential (solo admin).
 */
@Injectable({ providedIn: 'root' })
export class RentriCredentialService {
  private readonly API_URL = `${environment.apiUrl}/rentri/credential`

  constructor(private http: HttpClient) {}

  getStatus(): Observable<RentriCredentialStatus> {
    return this.http.get<RentriCredentialStatus>(this.API_URL)
  }

  setCredential(
    payload: SetCredentialPem | SetCredentialPkcs12
  ): Observable<{ success: boolean; algorithm?: 'RS256' | 'ES256' }> {
    return this.http.put<{ success: boolean; algorithm?: 'RS256' | 'ES256' }>(this.API_URL, payload)
  }

  remove(): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(this.API_URL)
  }
}
