import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import { DatiImpostazioneFatturazione, ImpostazioneFatturazione } from './legami.model'

@Injectable({ providedIn: 'root' })
export class ImpostazioneFatturazioneService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/impostazioni-fatturazione`

  leggi(): Observable<ImpostazioneFatturazione> {
    return this.http.get<ImpostazioneFatturazione>(this.url)
  }

  salva(dati: DatiImpostazioneFatturazione): Observable<ImpostazioneFatturazione> {
    return this.http.put<ImpostazioneFatturazione>(this.url, dati)
  }
}
