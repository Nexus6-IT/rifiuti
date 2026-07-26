import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'

/**
 * Unità locale RENTRI così come letta dall'ente (`GET /anagrafiche/v1.0/operatore/{num_iscr}/siti`,
 * R4 Task 3) — stessa tabella di `RentriUnitaLocaleService` (`/rentri/sedi`, CRUD manuale R2): non
 * ci sono due tipi di "unità locale", solo due modi di popolarla (a mano, o dall'ente).
 */
export interface RentriSito {
  id: string
  numIscrSito: string
  denominazione: string
  principale: boolean
  attiva: boolean
  updatedAt: string
}

/**
 * Client per la sezione «Unità locali» dell'area RENTRI (R4 Task 7 Step 1):
 * legge dalla cache locale (`GET /rentri/siti`) e forza la rilettura
 * dall'ente su richiesta esplicita dell'utente (`POST /rentri/siti/aggiorna`).
 * Backend: api/v1/rentri/siti (SUPER_ADMIN/ADMIN, v. `RentriSitiController`).
 */
@Injectable({ providedIn: 'root' })
export class RentriSitiService {
  private readonly API_URL = `${environment.apiUrl}/rentri/siti`

  constructor(private http: HttpClient) {}

  list(): Observable<RentriSito[]> {
    return this.http.get<{ items: RentriSito[] }>(this.API_URL).pipe(map(res => res.items))
  }

  aggiorna(): Observable<RentriSito[]> {
    return this.http
      .post<{ items: RentriSito[] }>(`${this.API_URL}/aggiorna`, {})
      .pipe(map(res => res.items))
  }
}
