import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, from, tap, throwError } from 'rxjs';
import { ArchivioGiro } from './archivio-giro';
import type { GiroVista, RitiroVista } from './modelli';
import { SessioneService } from './sessione.service';

/** Data locale 'AAAA-MM-GG' (il giro e' del giorno di calendario dell'autista, non UTC). */
export function dataLocaleIso(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const gg = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${gg}`;
}

/**
 * Server non raggiungibile: nessuna rete (status 0) oppure 502/503/504. Con il service worker
 * attivo una richiesta caduta per mancanza di rete arriva alla pagina come 504 sintetico
 * («Gateway Timeout» generato da ngsw), non come status 0.
 */
export function nonRaggiungibile(e: HttpErrorResponse): boolean {
  return e.status === 0 || (e.status >= 502 && e.status <= 504);
}

/**
 * Giro del giorno. In rete lo scarica e ne tiene una copia (snapshot) nell'archivio del telefono;
 * senza rete (o server irraggiungibile) ripiega sulla copia, ma solo se e' dello stesso utente e dello stesso
 * giorno. La copia viene cancellata a fine giornata, al logout e al cambio utente. Il service
 * worker non vede mai i dati: stanno solo qui.
 */
@Injectable({ providedIn: 'root' })
export class GiroService {
  private readonly http = inject(HttpClient);
  private readonly archivio = inject(ArchivioGiro);
  private readonly sessione = inject(SessioneService);
  private readonly _corrente = signal<GiroVista | null>(null);
  private readonly _aggiornatoIl = signal<string | null>(null);
  private readonly _daArchivio = signal(false);
  readonly corrente = this._corrente.asReadonly();
  /** Istante (ISO) dell'ultimo scaricamento riuscito dei dati mostrati. */
  readonly aggiornatoIl = this._aggiornatoIl.asReadonly();
  /** `true` se i dati mostrati vengono dalla copia sul telefono, non dalla rete. */
  readonly daArchivio = this._daArchivio.asReadonly();

  carica(data: string): Observable<GiroVista> {
    return this.http
      .get<GiroVista>('/api/v1/campo/giro', { params: new HttpParams().set('data', data) })
      .pipe(
        tap((g) => {
          const adesso = new Date().toISOString();
          this.impostaFresco(g, adesso);
          const utenteId = this.sessione.utenteId();
          if (utenteId) {
            void this.archivio
              .salva({ utenteId, data, aggiornatoIl: adesso, giro: g })
              .catch(() => undefined);
          }
        }),
        catchError((e: unknown) =>
          e instanceof HttpErrorResponse && nonRaggiungibile(e)
            ? from(this.ripristina(data, e))
            : throwError(() => e),
        ),
      );
  }

  impostaFresco(giro: GiroVista, aggiornatoIl: string): void {
    this._corrente.set(giro);
    this._aggiornatoIl.set(aggiornatoIl);
    this._daArchivio.set(false);
  }

  impostaDaArchivio(giro: GiroVista, aggiornatoIl: string): void {
    this._corrente.set(giro);
    this._aggiornatoIl.set(aggiornatoIl);
    this._daArchivio.set(true);
  }

  ritiro(id: string): RitiroVista | undefined {
    return this._corrente()?.ritiri.find((r) => r.id === id);
  }

  /** Logout: svuota memoria e copia sul telefono. */
  svuota(): void {
    this._corrente.set(null);
    this._aggiornatoIl.set(null);
    this._daArchivio.set(false);
    void this.archivio.cancella().catch(() => undefined);
  }

  /** All'avvio: cancella la copia di ieri o di un altro utente (telefoni condivisi). */
  async pulisciObsoleto(oggi: string): Promise<void> {
    try {
      const s = await this.archivio.leggi();
      if (s && !this.valido(s.utenteId, s.data, oggi)) await this.archivio.cancella();
    } catch {
      /* archivio non disponibile */
    }
  }

  private async ripristina(data: string, erroreRete: HttpErrorResponse): Promise<GiroVista> {
    try {
      const s = await this.archivio.leggi();
      if (s) {
        if (this.valido(s.utenteId, s.data, data)) {
          this.impostaDaArchivio(s.giro, s.aggiornatoIl);
          return s.giro;
        }
        await this.archivio.cancella();
      }
    } catch {
      /* archivio non disponibile: resta l'errore di rete */
    }
    throw erroreRete;
  }

  private valido(utenteId: string, dataSnapshot: string, oggi: string): boolean {
    const io = this.sessione.utenteId();
    return io !== null && io === utenteId && dataSnapshot === oggi;
  }
}
