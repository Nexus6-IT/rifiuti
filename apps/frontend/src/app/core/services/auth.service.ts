import { Injectable, inject, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Router } from '@angular/router'
import { Observable, tap, catchError, of, map } from 'rxjs'
import { environment } from '../../../environments/environment'

export interface User {
  id: string
  email: string
  firstName?: string
  lastName?: string
  role?: string
}

interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: User
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

  constructor() {
    this.initializeAuth()
  }

  private initializeAuth(): void {
    const accessToken = this.getAccessToken()
    if (accessToken) {
      this.getSession().subscribe({
        next: session => {
          this.currentUser.set(session.user)
          this.isAuthenticated.set(true)
        },
        error: () => localStorage.clear(),
      })
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
        localStorage.clear()
        this.currentUser.set(null)
        this.isAuthenticated.set(false)
        this.router.navigate(['/login'])
      }),
      catchError(() => {
        localStorage.clear()
        this.currentUser.set(null)
        this.isAuthenticated.set(false)
        this.router.navigate(['/login'])
        return of(void 0)
      })
    )
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
