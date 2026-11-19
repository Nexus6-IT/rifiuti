import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import type { GiroVista, RitiroVista } from './modelli';

/** Data locale 'AAAA-MM-GG' (il giro e' del giorno di calendario dell'autista, non UTC). */
export function dataLocaleIso(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const gg = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${gg}`;
}

/**
 * Giro del giorno (online). Il giro sta SOLO in memoria (signal): nessuna cache su disco ne' nel
 * service worker, in P2 l'app non funziona offline (P3).
 */
@Injectable({ providedIn: 'root' })
export class GiroService {
  private readonly http = inject(HttpClient);
  private readonly _corrente = signal<GiroVista | null>(null);
  readonly corrente = this._corrente.asReadonly();

  carica(data: string): Observable<GiroVista> {
    return this.http
      .get<GiroVista>('/api/v1/campo/giro', { params: new HttpParams().set('data', data) })
      .pipe(tap((g) => this._corrente.set(g)));
  }

  ritiro(id: string): RitiroVista | undefined {
    return this._corrente()?.ritiri.find((r) => r.id === id);
  }

  svuota(): void {
    this._corrente.set(null);
  }
}
