import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiUrl = environment.apiUrl;
  readonly currentUser = signal<User | null>(null);
  readonly isAuthenticated = signal<boolean>(false);

  constructor() {
    this.initializeAuth();
  }

  private initializeAuth(): void {
    const accessToken = this.getAccessToken();
    if (accessToken) {
      this.getSession().subscribe({
        next: (session) => {
          this.currentUser.set(session.user);
          this.isAuthenticated.set(true);
        },
        error: () => localStorage.clear(),
      });
    }
  }

  /**
   * Simple email-based login for development mode
   */
  login(email: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/dev/login`, { email }).pipe(
      tap((response) => {
        localStorage.setItem('accessToken', response.accessToken);
        localStorage.setItem('refreshToken', response.refreshToken);
        this.currentUser.set(response.user);
        this.isAuthenticated.set(true);
      })
    );
  }

  loginWithSPID(returnUrl?: string): void {
    const params = new URLSearchParams({ provider: 'spid' });
    if (returnUrl) params.set('returnUrl', returnUrl);
    window.location.href = `${this.apiUrl}/auth/login?${params}`;
  }

  loginWithCIE(returnUrl?: string): void {
    const params = new URLSearchParams({ provider: 'cie' });
    if (returnUrl) params.set('returnUrl', returnUrl);
    window.location.href = `${this.apiUrl}/auth/login?${params}`;
  }

  handleCallback(samlResponse: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/callback`, { SAMLResponse: samlResponse }).pipe(
      tap((response) => {
        localStorage.setItem('accessToken', response.accessToken);
        localStorage.setItem('refreshToken', response.refreshToken);
        this.currentUser.set(response.user);
        this.isAuthenticated.set(true);
      })
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/auth/logout`, {}).pipe(
      tap(() => {
        localStorage.clear();
        this.currentUser.set(null);
        this.isAuthenticated.set(false);
        this.router.navigate(['/login']);
      }),
      catchError(() => {
        localStorage.clear();
        this.currentUser.set(null);
        this.isAuthenticated.set(false);
        this.router.navigate(['/login']);
        return of(void 0);
      })
    );
  }

  getSession(): Observable<{ user: User }> {
    return this.http.get<{ user: User }>(`${this.apiUrl}/auth/session`);
  }

  getSpidStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/auth/spid-status`);
  }

  getAccessToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  getRefreshToken(): string | null {
    return localStorage.getItem('refreshToken');
  }
}
