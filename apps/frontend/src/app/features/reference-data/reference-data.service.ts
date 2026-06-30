import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Conteggi per dataset (stato popolamento) — shape reale di GET /reference-data/status. */
export interface ReferenceDataStatus {
  ateco: number
  nazioni: number
  province: number
  comuni: number
}

/** Record ATECO (modello AtecoCode). */
export interface AtecoCode {
  code: string
  description: string
  updatedAt: string
}

/** Record comune ISTAT (modello IstatComune). */
export interface IstatComune {
  code: string
  name: string
  provinciaSigla: string
  codiceCatastale?: string | null
  cap?: string | null
  updatedAt: string
}

/** Dataset selezionabile per il reseed (allineato a ReferenceDataset backend). */
export type ReferenceDataset = 'ateco' | 'nazioni' | 'province' | 'comuni'

/** Risposta di POST /reference-data/reseed. */
export interface ReseedResponse {
  accepted: boolean
  dataset: ReferenceDataset | 'all'
}

/**
 * Client per i dati di riferimento condivisi (ISTAT/ATECO):
 * stato popolamento, ricerca comuni/ATECO, reseed (admin).
 */
@Injectable({ providedIn: 'root' })
export class ReferenceDataService {
  private readonly http = inject(HttpClient)
  private readonly API_URL = `${environment.apiUrl}/reference-data`

  /** Conteggi dei dataset di riferimento. */
  getStatus(): Observable<ReferenceDataStatus> {
    return this.http.get<ReferenceDataStatus>(`${this.API_URL}/status`)
  }

  /** Ricerca comuni per nome (case-insensitive). */
  searchComuni(q: string): Observable<IstatComune[]> {
    return this.http.get<IstatComune[]>(`${this.API_URL}/comuni`, { params: { q } })
  }

  /** Ricerca codici ATECO per codice o descrizione. */
  searchAteco(q: string): Observable<AtecoCode[]> {
    return this.http.get<AtecoCode[]>(`${this.API_URL}/ateco`, { params: { q } })
  }

  /**
   * Avvia il reseed dei dati di riferimento (admin). Senza dataset ripopola
   * tutto; con dataset ripopola solo quello. Operazione best-effort in
   * background lato backend: ritorna subito 202 Accepted.
   */
  reseed(dataset?: ReferenceDataset): Observable<ReseedResponse> {
    return this.http.post<ReseedResponse>(
      `${this.API_URL}/reseed`,
      {},
      dataset ? { params: { dataset } } : {}
    )
  }
}
