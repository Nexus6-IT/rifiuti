import { Injectable, inject, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable, of, tap, catchError, shareReplay } from 'rxjs'
import { environment } from '../../../environments/environment'

/**
 * Identità anagrafica della società attiva (tenant effettivo della richiesta),
 * restituita da `GET /api/v1/me/company`.
 */
export interface ActiveCompany {
  id: string
  ragioneSociale: string
  partitaIva: string
}

/**
 * CompanyService
 *
 * Espone l'identità della società attiva (ragione sociale + partita IVA). È
 * usata dal registro C/S per determinare, dato un FIR, se il movimento è un
 * CARICO (la società è il DESTINATARIO del FIR) o uno SCARICO (è il PRODUTTORE),
 * confrontando la partita IVA / ragione sociale con lo snapshot delle parti.
 *
 * La chiamata è condivisa (`shareReplay`) e la risposta viene mantenuta in un
 * signal così da poter essere letta in modo sincrono dopo il primo caricamento.
 * Uno switch di società fa un reload dell'app, quindi la cache si azzera.
 */
@Injectable({ providedIn: 'root' })
export class CompanyService {
  private readonly http = inject(HttpClient)

  /** Ultima società attiva caricata (null se sconosciuta / super admin globale). */
  readonly activeCompany = signal<ActiveCompany | null>(null)

  private inFlight$: Observable<ActiveCompany | null> | null = null

  /**
   * Carica l'identità della società attiva. Idempotente: le chiamate concorrenti
   * condividono la stessa richiesta. In caso di errore ritorna `null` senza
   * bloccare il chiamante (l'auto-tipo resta semplicemente non determinabile).
   */
  loadActiveCompany(): Observable<ActiveCompany | null> {
    if (this.activeCompany()) {
      return of(this.activeCompany())
    }
    if (this.inFlight$) {
      return this.inFlight$
    }
    this.inFlight$ = this.http.get<ActiveCompany | null>(`${environment.apiUrl}/me/company`).pipe(
      tap(company => this.activeCompany.set(company ?? null)),
      catchError(() => of(null)),
      shareReplay(1)
    )
    return this.inFlight$
  }
}
