import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, from, switchMap, throwError } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  ElencoRitiri,
  FiltriRitiri,
  ModificaRitiro,
  NuovoRitiro,
  RisultatoCreazioneRitiri,
  RisultatoGenerazioneFir,
  RitiroVista,
} from './ritiri.model'

/**
 * Client delle rotte dei ritiri (P7 §3). Ogni scrittura su un ritiro esistente porta la `versione`
 * letta (lock ottimistico: 409 `RITIRO_MODIFICATO`).
 */
@Injectable({ providedIn: 'root' })
export class RitiriService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/ritiri`

  /** Solo i filtri valorizzati viaggiano. */
  elenca(filtri: FiltriRitiri = {}): Observable<ElencoRitiri> {
    let params = new HttpParams()
    for (const [chiave, valore] of Object.entries(filtri)) {
      if (valore !== undefined && valore !== null && String(valore).trim() !== '') {
        params = params.set(chiave, String(valore))
      }
    }
    return this.http.get<ElencoRitiri>(this.base, { params })
  }

  dettaglio(id: string): Observable<RitiroVista> {
    return this.http.get<RitiroVista>(`${this.base}/${id}`)
  }

  crea(dati: NuovoRitiro): Observable<RisultatoCreazioneRitiri> {
    return this.http.post<RisultatoCreazioneRitiri>(this.base, dati)
  }

  modifica(id: string, dati: ModificaRitiro): Observable<RitiroVista> {
    return this.http.put<RitiroVista>(`${this.base}/${id}`, dati)
  }

  annulla(id: string, motivo: string, versione: number): Observable<RitiroVista> {
    return this.http.post<RitiroVista>(`${this.base}/${id}/annulla`, { motivo, versione })
  }

  nonEseguito(id: string, motivo: string, versione: number): Observable<RitiroVista> {
    return this.http.post<RitiroVista>(`${this.base}/${id}/non-eseguito`, { motivo, versione })
  }

  /** Riporta a PROGRAMMATO un ritiro non eseguito, con una data nuova (AAAA-MM-GG). */
  riprogramma(id: string, dataPrevista: string, versione: number): Observable<RitiroVista> {
    return this.http.post<RitiroVista>(`${this.base}/${id}/riprogramma`, { dataPrevista, versione })
  }

  /** Bozze di FIR dai ritiri indicati (da 1 a 100); nessuna emissione e nessuna trasmissione. */
  generaFir(ritiroIds: string[]): Observable<RisultatoGenerazioneFir> {
    return this.http.post<RisultatoGenerazioneFir>(`${this.base}/genera-fir`, { ritiroIds })
  }

  /** PDF del FIR sul modello predefinito (P7 §4: `GET /pdf/fir/:id`); `Content-Disposition` per il nome. */
  scaricaPdfFir(firId: string): Observable<HttpResponse<Blob>> {
    return this.comeErroreLeggibile(
      this.http.get(`${environment.apiUrl}/pdf/fir/${firId}`, {
        responseType: 'blob',
        observe: 'response',
      })
    )
  }

  /** PDF unico dei FIR attivi dei ritiri (da 1 a 100); `X-Ritiri-Saltati` conta quelli senza FIR. */
  stampaFir(ritiroIds: string[], modelloId?: string): Observable<HttpResponse<Blob>> {
    return this.comeErroreLeggibile(
      this.http.post(
        `${this.base}/stampa-fir`,
        { ritiroIds, ...(modelloId ? { modelloId } : {}) },
        { responseType: 'blob', observe: 'response' }
      )
    )
  }

  /** Distinta dei ritiri programmati del giorno (`AAAA-MM-GG`), per un mezzo o per tutti. */
  distinta(data: string, automezzoId?: string, modelloId?: string): Observable<HttpResponse<Blob>> {
    let params = new HttpParams().set('data', data)
    if (automezzoId) params = params.set('automezzoId', automezzoId)
    if (modelloId) params = params.set('modelloId', modelloId)
    return this.comeErroreLeggibile(
      this.http.get(`${this.base}/distinta.pdf`, {
        params,
        responseType: 'blob',
        observe: 'response',
      })
    )
  }

  /**
   * Con `responseType: 'blob'` anche il corpo dell'errore è un Blob: lo si legge come JSON, così
   * `messaggioErroreRitiri` distingue 400 e 404 invece di dare sempre il ripiego.
   */
  private comeErroreLeggibile<T>(richiesta: Observable<T>): Observable<T> {
    return richiesta.pipe(
      catchError((err: unknown) => {
        if (!(err instanceof HttpErrorResponse) || !(err.error instanceof Blob)) {
          return throwError(() => err)
        }
        return from(err.error.text()).pipe(
          switchMap(testo => {
            let corpo: unknown = null
            try {
              corpo = JSON.parse(testo)
            } catch {
              corpo = null
            }
            return throwError(
              () =>
                new HttpErrorResponse({
                  error: corpo,
                  headers: err.headers,
                  status: err.status,
                  statusText: err.statusText,
                  url: err.url ?? undefined,
                })
            )
          })
        )
      })
    )
  }
}
