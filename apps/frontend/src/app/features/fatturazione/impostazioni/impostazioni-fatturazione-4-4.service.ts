import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { environment } from '../../../../environments/environment'
import { CedenteVista, DatiCedente, DatiPartenza, NumerazioneVista } from './impostazioni.model'

/**
 * Servizio HTTP delle schede «Dati del cedente» e «Numerazione» (4.4a). Separato da
 * `ImpostazioneFatturazioneService` della 4.3: gli endpoint sono diversi.
 */
@Injectable({ providedIn: 'root' })
export class ImpostazioniFatturazione44Service {
  private readonly http = inject(HttpClient)
  private readonly urlCedente = `${environment.apiUrl}/cedente-fatturazione`
  private readonly urlNumerazioni = `${environment.apiUrl}/numerazioni-fattura`

  leggiCedente(): Observable<CedenteVista> {
    return this.http.get<CedenteVista>(this.urlCedente)
  }

  salvaCedente(dati: DatiCedente): Observable<CedenteVista> {
    return this.http.put<CedenteVista>(this.urlCedente, dati)
  }

  numerazioni(anno: number): Observable<NumerazioneVista[]> {
    return this.http.get<NumerazioneVista[]>(this.urlNumerazioni, {
      params: new HttpParams().set('anno', String(anno)),
    })
  }

  impostaPartenza(
    registroIvaId: string,
    anno: number,
    dati: DatiPartenza
  ): Observable<NumerazioneVista> {
    return this.http.put<NumerazioneVista>(
      `${this.urlNumerazioni}/${encodeURIComponent(registroIvaId)}/${anno}`,
      dati
    )
  }
}
