import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
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
}
