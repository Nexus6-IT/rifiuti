import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'
import { AnteprimaOrso, ComunicazioneVista, FileScaricato } from './comunicazioni.model'

function nomeFileDa(disposition: string | null): string | null {
  if (!disposition) return null
  const esteso = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (esteso) {
    try {
      return decodeURIComponent(esteso[1].trim())
    } catch {
      /* ripiego sul nome semplice */
    }
  }
  const semplice = /filename="?([^";]+)"?/i.exec(disposition)
  return semplice ? semplice[1].trim() : null
}

/** Client HTTP delle comunicazioni ai consorzi (4.9a, O.R.SO.). Backend: `/comunicazioni`. */
@Injectable({ providedIn: 'root' })
export class ComunicazioniService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/comunicazioni`

  anteprimaOrso(unitaLocaleId: string, anno: number): Observable<AnteprimaOrso> {
    const params = new HttpParams().set('unitaLocaleId', unitaLocaleId).set('anno', String(anno))
    return this.http.get<AnteprimaOrso>(`${this.url}/orso/anteprima`, { params })
  }

  generaOrso(unitaLocaleId: string, anno: number): Observable<ComunicazioneVista> {
    return this.http.post<ComunicazioneVista>(`${this.url}/orso`, { unitaLocaleId, anno })
  }

  storicoOrso(unitaLocaleId: string, anno: number): Observable<ComunicazioneVista[]> {
    const params = new HttpParams()
      .set('consorzio', 'ORSO')
      .set('unitaLocaleId', unitaLocaleId)
      .set('anno', String(anno))
    return this.http.get<ComunicazioneVista[]>(this.url, { params })
  }

  scaricaFile(id: string): Observable<FileScaricato> {
    return this.http
      .get(`${this.url}/${id}/file`, { responseType: 'blob', observe: 'response' })
      .pipe(
        map((r: HttpResponse<Blob>) => ({
          blob: r.body ?? new Blob(),
          nomeFile: nomeFileDa(r.headers.get('Content-Disposition')),
        }))
      )
  }

  segnaInviata(id: string): Observable<ComunicazioneVista> {
    return this.http.post<ComunicazioneVista>(`${this.url}/${id}/inviata`, {})
  }
}
