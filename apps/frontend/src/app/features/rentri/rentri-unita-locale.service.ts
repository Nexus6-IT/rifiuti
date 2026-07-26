import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'

/** Unità locale RENTRI del tenant (sede operativa iscritta a RENTRI). */
export interface RentriUnitaLocale {
  id: string
  numIscrSito: string
  denominazione: string
  principale: boolean
  attiva: boolean
  createdAt: string
  updatedAt: string
}

/** Dati per creare una nuova unità locale. */
export interface CreateRentriUnitaLocale {
  numIscrSito: string
  denominazione: string
  principale?: boolean
}

/** Dati aggiornabili di un'unità locale esistente. */
export interface UpdateRentriUnitaLocale {
  denominazione?: string
  attiva?: boolean
}

/**
 * Client per la gestione delle unità locali RENTRI del tenant (R2 multi-sede).
 * Backend: api/v1/rentri/unita-locali (lettura per ogni utente autenticato,
 * scrittura solo admin — enforcement lato backend).
 */
@Injectable({ providedIn: 'root' })
export class RentriUnitaLocaleService {
  private readonly API_URL = `${environment.apiUrl}/rentri/unita-locali`

  constructor(private http: HttpClient) {}

  list(): Observable<RentriUnitaLocale[]> {
    return this.http.get<{ items: RentriUnitaLocale[] }>(this.API_URL).pipe(map(res => res.items))
  }

  create(payload: CreateRentriUnitaLocale): Observable<RentriUnitaLocale> {
    return this.http.post<RentriUnitaLocale>(this.API_URL, payload)
  }

  update(id: string, payload: UpdateRentriUnitaLocale): Observable<RentriUnitaLocale> {
    return this.http.put<RentriUnitaLocale>(`${this.API_URL}/${id}`, payload)
  }

  setPrincipale(id: string): Observable<RentriUnitaLocale> {
    return this.http.put<RentriUnitaLocale>(`${this.API_URL}/${id}/principale`, {})
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`)
  }
}
