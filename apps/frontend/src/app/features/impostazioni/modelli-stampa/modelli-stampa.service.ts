import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { environment } from '../../../../environments/environment'
import { DatiModelloStampa, ModelloStampaVista } from './modello-stampa.model'

/**
 * Servizio HTTP dei modelli di stampa (`ModelliStampaController`, solo ADMIN). Le modifiche
 * portano la `versione` letta: un 409 vuol dire che il modello e' cambiato nel frattempo.
 */
@Injectable({ providedIn: 'root' })
export class ModelliStampaService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/modelli-stampa`

  elenco(): Observable<ModelloStampaVista[]> {
    return this.http.get<ModelloStampaVista[]>(this.url)
  }

  crea(dati: DatiModelloStampa): Observable<ModelloStampaVista> {
    return this.http.post<ModelloStampaVista>(this.url, dati)
  }

  modifica(id: string, dati: DatiModelloStampa, versione: number): Observable<ModelloStampaVista> {
    return this.http.put<ModelloStampaVista>(`${this.url}/${encodeURIComponent(id)}`, {
      ...dati,
      versione,
    })
  }

  /** Rende il modello il predefinito del suo ambito (il server toglie il flag all'altro). */
  rendiPredefinito(id: string, versione: number): Observable<ModelloStampaVista> {
    return this.http.post<ModelloStampaVista>(`${this.url}/${encodeURIComponent(id)}/predefinito`, {
      versione,
    })
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}
