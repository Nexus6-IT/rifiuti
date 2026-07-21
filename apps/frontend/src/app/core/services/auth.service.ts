import { Injectable, inject, signal } from '@angular/core'
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { Router } from '@angular/router'
import {
  Observable,
  tap,
  catchError,
  of,
  map,
  throwError,
  finalize,
  shareReplay,
  switchMap,
} from 'rxjs'
import { environment } from '../../../environments/environment'

export interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  role?: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
}

interface RefreshResponse {
  accessToken: string
  expiresIn: number
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient)
  private readonly router = inject(Router)
  private readonly apiUrl = environment.apiUrl
  readonly currentUser = signal<User | null>(null)
  readonly isAuthenticated = signal<boolean>(false)

  /** Rinnovo in corso: condiviso tra richieste concorrenti per evitare N refresh paralleli. */
  private refreshInFlight$: Observable<string> | null = null

  constructor() {
    this.initializeAuth()
  }

  /**
   * Bootstrap della sessione al load dell'app — deve essere RESILIENTE al refresh
   * e ai deep-link: un access token valido in localStorage NON deve mai portare a
   * un logout forzato per via di un errore transitorio di rete.
   *
   * Strategia:
   *  - Se non c'è nessun token, non c'è sessione: nulla da fare.
   *  - Se il token è valido (claim `exp` non scaduto) consideriamo l'utente
   *    autenticato SUBITO (ottimisticamente, dal token decodificato), così il
   *    guard non fallisce nemmeno prima che /auth/profile risponda.
   *  - Proviamo comunque a idratare la sessione con getSession():
   *      · su 401 tentiamo un refresh; solo se ANCHE il refresh fallisce facciamo
   *        logout pulito (clearSession, NON localStorage.clear()).
   *      · su errori NON-401 (rete/5xx transitori) NON tocchiamo la sessione:
   *        i token restano, si riproverà al prossimo giro.
   */
  private initializeAuth(): void {
    const accessToken = this.getAccessToken()
    if (!accessToken) {
      return
    }

    // Autenticazione ottimistica: se il token è ancora valido, l'utente è dentro.
    if (this.isTokenValid()) {
      this.isAuthenticated.set(true)
      const userFromToken = this.decodeUserFromToken()
      if (userFromToken) {
        this.currentUser.set(userFromToken)
      }
    }

    this.getSession().subscribe({
      next: session => {
        this.currentUser.set(session.user)
        this.isAuthenticated.set(true)
      },
      error: (error: HttpErrorResponse) => {
        // Errori transitori (rete/5xx): conserva i token, riprova più tardi.
        if (error.status !== 401) {
          return
        }
        // 401: prova UNA volta il refresh; solo se fallisce anche quello, logout pulito.
        this.refreshAccessToken()
          .pipe(switchMap(() => this.getSession()))
          .subscribe({
            next: session => {
              this.currentUser.set(session.user)
              this.isAuthenticated.set(true)
            },
            error: () => this.clearSession(),
          })
      },
    })
  }

  /**
   * Ricostruisce un User "best-effort" dai claim dell'access token, per popolare
   * lo stato in memoria prima che /auth/profile risponda. Token malformato => null.
   */
  private decodeUserFromToken(): User | null {
    const token = this.getAccessToken()
    if (!token) return null
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const id = payload.id ?? payload.sub
      if (!id) return null
      return {
        id,
        email: payload.email ?? '',
        firstName: payload.firstName,
        lastName: payload.lastName,
        role: payload.role,
      }
    } catch {
      return null
    }
  }

  /**
   * Simple email-based login for development mode
   */
  login(email: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/dev/login`, { email }).pipe(
      tap(response => {
        localStorage.setItem('accessToken', response.accessToken)
        localStorage.setItem('refreshToken', response.refreshToken)
        this.currentUser.set(response.user)
        this.isAuthenticated.set(true)
      })
    )
  }

  /**
   * Completa il login SAML/Keycloak: salva i token ricevuti dal callback
   * (via fragment) e carica la sessione utente.
   */
  completeSpidLogin(accessToken: string, refreshToken: string): Observable<{ user: User }> {
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    return this.getSession().pipe(
      tap(session => {
        this.currentUser.set(session.user)
        this.isAuthenticated.set(true)
      })
    )
  }

  loginWithSPID(returnUrl?: string): void {
    const params = new URLSearchParams({ provider: 'spid' })
    if (returnUrl) params.set('returnUrl', returnUrl)
    window.location.href = `${this.apiUrl}/auth/spid/login?${params}`
  }

  loginWithCIE(returnUrl?: string): void {
    const params = new URLSearchParams({ provider: 'cie' })
    if (returnUrl) params.set('returnUrl', returnUrl)
    window.location.href = `${this.apiUrl}/auth/spid/login?${params}`
  }

  handleCallback(samlResponse: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/auth/callback`, { SAMLResponse: samlResponse })
      .pipe(
        tap(response => {
          localStorage.setItem('accessToken', response.accessToken)
          localStorage.setItem('refreshToken', response.refreshToken)
          this.currentUser.set(response.user)
          this.isAuthenticated.set(true)
        })
      )
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/auth/logout`, {}).pipe(
      tap(() => {
        this.clearSession()
        this.router.navigate(['/login'])
      }),
      catchError(() => {
        this.clearSession()
        this.router.navigate(['/login'])
        return of(void 0)
      })
    )
  }

  /**
   * Rinnova l'access token usando il refresh token (endpoint pubblico /auth/refresh).
   * Le richieste concorrenti condividono la STESSA chiamata (`shareReplay`) così un
   * burst di 401 genera un solo refresh. Emette il nuovo access token, oppure erra
   * se non c'è un refresh token o il backend lo rifiuta (→ il chiamante fa logout).
   */
  refreshAccessToken(): Observable<string> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$
    }

    const refreshToken = this.getRefreshToken()
    if (!refreshToken) {
      return throwError(() => new Error('Nessun refresh token disponibile'))
    }

    this.refreshInFlight$ = this.http
      .post<RefreshResponse>(`${this.apiUrl}/auth/refresh`, { refreshToken })
      .pipe(
        map(res => {
          localStorage.setItem('accessToken', res.accessToken)
          return res.accessToken
        }),
        finalize(() => {
          this.refreshInFlight$ = null
        }),
        shareReplay(1)
      )

    return this.refreshInFlight$
  }

  getSession(): Observable<{ user: User }> {
    // Il backend espone /auth/profile (ritorna l'utente "grezzo"); lo avvolgo in { user }.
    return this.http.get<User>(`${this.apiUrl}/auth/profile`).pipe(map(u => ({ user: u })))
  }

  getSpidStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/auth/spid-status`)
  }

  getAccessToken(): string | null {
    return localStorage.getItem('accessToken')
  }

  getRefreshToken(): string | null {
    return localStorage.getItem('refreshToken')
  }

  /**
   * Pulisce completamente la sessione: token, eventuali chiavi di
   * impersonificazione / contesto admin, e stato in memoria.
   */
  clearSession(): void {
    ;[
      'accessToken',
      'refreshToken',
      'wf_impersonator_token',
      'wf_impersonator_refresh',
      'wf_impersonating_name',
      'wf_admin_tenant',
    ].forEach(k => localStorage.removeItem(k))
    this.currentUser.set(null)
    this.isAuthenticated.set(false)
  }

  /**
   * Verifica che l'access token sia presente e NON scaduto (claim `exp`).
   * Decodifica best-effort: token malformato => considerato non valido.
   */
  isTokenValid(): boolean {
    const token = this.getAccessToken()
    if (!token) return false
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (!payload?.exp) return true // nessuna scadenza dichiarata
      // exp e' in secondi; piccolo margine (5s) per evitare race a cavallo della scadenza.
      return payload.exp * 1000 > Date.now() + 5000
    } catch {
      return false
    }
  }
}
