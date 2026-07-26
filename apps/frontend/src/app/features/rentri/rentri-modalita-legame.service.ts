import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Modalità con cui il tenant lega i FIR ai formulari RENTRI. */
export type RentriModalitaLegame = 'AUTOMATICA' | 'IBRIDA' | 'MANUALE'

/** Stato della modalità di legame RENTRI del tenant. */
export interface RentriModalitaLegameStatus {
  modalitaLegame: RentriModalitaLegame
  certificatoConfigurato: boolean
}

/**
 * Client per la gestione della modalità di legame RENTRI del tenant.
 * Backend: api/v1/rentri/modalita-legame (solo admin).
 */
@Injectable({ providedIn: 'root' })
export class RentriModalitaLegameService {
  private readonly API_URL = `${environment.apiUrl}/rentri/modalita-legame`

  constructor(private http: HttpClient) {}

  getStatus(): Observable<RentriModalitaLegameStatus> {
    return this.http.get<RentriModalitaLegameStatus>(this.API_URL)
  }

  setModalita(modalitaLegame: RentriModalitaLegame): Observable<RentriModalitaLegameStatus> {
    return this.http.patch<RentriModalitaLegameStatus>(this.API_URL, { modalitaLegame })
  }
}
