import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  AnteprimaTracciato,
  ComunicazioneTracciatoVista,
  ConsorzioTracciato,
} from './tracciati.model'

const ROTTA: Record<ConsorzioTracciato, string> = { CONOU: 'conou', COBAT: 'cobat' }

/** Client HTTP dei tracciati a record CONOU e COBAT (4.9c-d). Backend: `/comunicazioni`. */
@Injectable({ providedIn: 'root' })
export class TracciatiService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/comunicazioni`

  anteprima(
    consorzio: ConsorzioTracciato,
    unitaLocaleId: string,
    da: string,
    a: string
  ): Observable<AnteprimaTracciato> {
    const params = new HttpParams().set('unitaLocaleId', unitaLocaleId).set('da', da).set('a', a)
    return this.http.get<AnteprimaTracciato>(`${this.url}/${ROTTA[consorzio]}/anteprima`, {
      params,
    })
  }

  genera(
    consorzio: ConsorzioTracciato,
    unitaLocaleId: string,
    da: string,
    a: string
  ): Observable<ComunicazioneTracciatoVista> {
    return this.http.post<ComunicazioneTracciatoVista>(`${this.url}/${ROTTA[consorzio]}`, {
      unitaLocaleId,
      da,
      a,
    })
  }

  storico(
    consorzio: ConsorzioTracciato,
    unitaLocaleId: string,
    da: string,
    a: string
  ): Observable<ComunicazioneTracciatoVista[]> {
    const params = new HttpParams()
      .set('consorzio', consorzio)
      .set('unitaLocaleId', unitaLocaleId)
      .set('da', da)
      .set('a', a)
    return this.http.get<ComunicazioneTracciatoVista[]>(`${this.url}/tracciati`, { params })
  }
}
