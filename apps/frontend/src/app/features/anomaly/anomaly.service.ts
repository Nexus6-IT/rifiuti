import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Tipi di anomalia rilevati dal backend (rule-based). */
export type AnomalyType =
  | 'INVALID_CER'
  | 'NON_POSITIVE_QUANTITY'
  | 'EXCESSIVE_QUANTITY'
  | 'MISSING_DESCRIPTION'
  | 'NEGATIVE_STOCK';

/** Livello di gravità dell'anomalia. */
export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/** Shape reale restituita da GET /anomaly (vedi Anomaly nel backend). */
export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  firId?: string;
  firNumber?: string;
  cerCode?: string;
}

/**
 * Client per il rilevamento anomalie su FIR e movimenti del tenant.
 * Endpoint: GET /anomaly (prefix globale /api/v1 già incluso in apiUrl).
 */
@Injectable({ providedIn: 'root' })
export class AnomalyService {
  private readonly API_URL = `${environment.apiUrl}/anomaly`;

  constructor(private http: HttpClient) {}

  /** Recupera l'elenco delle anomalie rilevate per il tenant corrente. */
  detect(): Observable<Anomaly[]> {
    return this.http.get<Anomaly[]>(this.API_URL);
  }
}
