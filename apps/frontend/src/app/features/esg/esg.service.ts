import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Riga di dettaglio per singolo codice CER nel report ESG. */
export interface EsgByCer {
  cerCode: string
  recoveryKg: number
  disposalKg: number
  co2AvoidedKg: number
}

/** Report ESG / CO2 restituito dal backend. */
export interface EsgReport {
  period: { from: string; to: string } | null
  totals: {
    producedKg: number
    recoveryKg: number
    disposalKg: number
    recyclingRate: number
  }
  landfillDivertedKg: number
  co2AvoidedKg: number
  byCer: EsgByCer[]
}

/**
 * Client per il report ESG / CO2: indicatori ambientali aggregati
 * (tasso di recupero, kg deviati da discarica, CO2 evitata) con dettaglio per CER.
 */
@Injectable({ providedIn: 'root' })
export class EsgService {
  private readonly API_URL = `${environment.apiUrl}/esg`

  constructor(private http: HttpClient) {}

  /**
   * Report ESG aggregato. Le date (ISO yyyy-mm-dd) sono opzionali:
   * se omesse il backend considera l'intero periodo disponibile.
   */
  getReport(startDate?: string, endDate?: string): Observable<EsgReport> {
    let params = new HttpParams()
    if (startDate) params = params.set('startDate', startDate)
    if (endDate) params = params.set('endDate', endDate)
    return this.http.get<EsgReport>(`${this.API_URL}/report`, { params })
  }
}
