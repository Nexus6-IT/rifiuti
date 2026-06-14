import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Riga di giacenza aggregata per codice CER. */
export interface Giacenza {
  cerCode: string;
  caricoKg: number;
  scaricoKg: number;
  giacenzaKg: number;
  oldestCaricoDate: string | null;
}

/** Motivo per cui un CER supera le soglie del deposito temporaneo. */
export type DepositoTemporaneoReason = 'DURATION' | 'QUANTITY';

/** Alert deposito temporaneo per un codice CER oltre soglia. */
export interface DepositoTemporaneoAlert {
  cerCode: string;
  giacenzaKg: number;
  reasons: DepositoTemporaneoReason[];
  durationDays?: number;
  oldestCaricoDate?: string | null;
}

/** Client per giacenze e controllo deposito temporaneo. */
@Injectable({ providedIn: 'root' })
export class GiacenzeService {
  private readonly API_URL = `${environment.apiUrl}/giacenze`;

  constructor(private http: HttpClient) {}

  /** Giacenze aggregate per codice CER (carico/scarico/giacenza). */
  getGiacenze(): Observable<Giacenza[]> {
    return this.http.get<Giacenza[]>(this.API_URL);
  }

  /** Alert deposito temporaneo per i CER che superano durata o quantità. */
  getDepositoTemporaneoAlerts(): Observable<DepositoTemporaneoAlert[]> {
    return this.http.get<DepositoTemporaneoAlert[]>(`${this.API_URL}/deposito-temporaneo/alerts`);
  }
}
