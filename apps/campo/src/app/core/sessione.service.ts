import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { ArchivioGiro } from './archivio-giro';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';

export const CHIAVE_SESSIONE = 'wasteflow.campo.sessione';
const API = '/api/v1';

interface Token {
  accessToken: string;
  refreshToken: string;
}

/**
 * Sessione dell'app campo. I token stanno in localStorage (il refresh dura 30 giorni, deve
 * sopravvivere alla chiusura dell'app). Il refresh token e' revocato dal server a ogni nuovo
 * accesso (sessione unica): un 401 sul rinnovo significa «sessione finita», non un errore da
 * ritentare. Senza rete (status 0) la sessione resta, per riprovare.
 */
@Injectable({ providedIn: 'root' })
export class SessioneService {
  private readonly http = inject(HttpClient);
  private readonly archivio = inject(ArchivioGiro);
  private readonly token = signal<Token | null>(this.leggi());
  private readonly allaChiusuraCb: Array<() => void> = [];
  private rinnovoInCorso: Observable<string> | null = null;

  readonly autenticato = computed(() => this.token() !== null);
  /** Identita (`sub`) letta dall'access token, senza verifica: serve solo ad abbinare lo snapshot. */
  readonly utenteId = computed(() => idDaToken(this.token()?.accessToken));

  /** Registra una pulizia da eseguire a fine sessione e a ogni nuovo accesso (cambio utente). */
  allaChiusura(fn: () => void): void {
    this.allaChiusuraCb.push(fn);
  }

  accessToken(): string | null {
    return this.token()?.accessToken ?? null;
  }

  /** Salva i token dal fragment (`#accessToken=..&refreshToken=..`) del ritorno SPID/CIE. */
  salvaDaFragment(fragment: string): boolean {
    const p = new URLSearchParams(fragment.replace(/^#/, ''));
    const accessToken = p.get('accessToken');
    const refreshToken = p.get('refreshToken');
    if (!accessToken || !refreshToken) return false;
    // Nuovo accesso: la copia del giro del precedente non deve sopravvivere.
    this.allaChiusuraCb.forEach((f) => f());
    void this.archivio.cancella().catch(() => undefined);
    this.imposta({ accessToken, refreshToken });
    return true;
  }

  /** Rinnova l'access token; piu' richieste concorrenti condividono una sola chiamata. */
  rinnova(): Observable<string> {
    const corrente = this.token();
    if (!corrente) return throwError(() => new Error('Nessuna sessione'));
    if (!this.rinnovoInCorso) {
      this.rinnovoInCorso = this.http
        .post<{ accessToken: string }>(`${API}/auth/refresh`, {
          refreshToken: corrente.refreshToken,
        })
        .pipe(
          map((r) => r.accessToken),
          tap((accessToken) => this.imposta({ ...corrente, accessToken })),
          catchError((e: unknown) => {
            if (e instanceof HttpErrorResponse && (e.status === 401 || e.status === 403)) {
              this.pulisci();
            }
            return throwError(() => e);
          }),
          finalize(() => (this.rinnovoInCorso = null)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.rinnovoInCorso;
  }

  /** Chiude la sessione: logout lato server (best effort) e pulizia locale. */
  esci(): Observable<void> {
    const corrente = this.token();
    const chiusura$ = corrente
      ? this.http.post(`${API}/auth/logout`, { refreshToken: corrente.refreshToken })
      : of(null);
    return chiusura$.pipe(
      catchError(() => of(null)),
      tap(() => this.pulisci()),
      map(() => undefined),
    );
  }

  pulisci(): void {
    this.token.set(null);
    this.allaChiusuraCb.forEach((f) => f());
    void this.archivio.cancella().catch(() => undefined);
    try {
      localStorage.removeItem(CHIAVE_SESSIONE);
    } catch {
      /* archivio non disponibile: resta la sola memoria */
    }
  }

  private imposta(t: Token): void {
    this.token.set(t);
    try {
      localStorage.setItem(CHIAVE_SESSIONE, JSON.stringify(t));
    } catch {
      /* archivio non disponibile (navigazione privata): la sessione vale finche' l'app e' aperta */
    }
  }

  private leggi(): Token | null {
    try {
      const grezzo = localStorage.getItem(CHIAVE_SESSIONE);
      if (!grezzo) return null;
      const t = JSON.parse(grezzo) as Partial<Token>;
      return typeof t.accessToken === 'string' && typeof t.refreshToken === 'string'
        ? { accessToken: t.accessToken, refreshToken: t.refreshToken }
        : null;
    } catch {
      return null;
    }
  }
}

function idDaToken(token: string | undefined): string | null {
  const corpo = token?.split('.')[1];
  if (!corpo) return null;
  try {
    const b64 = corpo.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}
