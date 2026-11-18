import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import { ConfigurazioneSdi, DatiConfigurazioneSdi, EsitoVerificaSdi } from './sdi.model'

@Injectable({ providedIn: 'root' })
export class ConfigurazioneSdiService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/sdi/configurazione`

  leggi(): Observable<ConfigurazioneSdi> {
    return this.http.get<ConfigurazioneSdi>(this.url)
  }

  salva(dati: DatiConfigurazioneSdi): Observable<ConfigurazioneSdi> {
    return this.http.put<ConfigurazioneSdi>(this.url, dati)
  }

  verifica(): Observable<EsitoVerificaSdi> {
    return this.http.post<EsitoVerificaSdi>(`${this.url}/verifica`, {})
  }

  rigeneraToken(versione: number): Observable<ConfigurazioneSdi> {
    return this.http.post<ConfigurazioneSdi>(`${this.url}/token`, { versione })
  }

  impostaInvioAttivo(attivo: boolean, versione: number): Observable<ConfigurazioneSdi> {
    return this.http.put<ConfigurazioneSdi>(`${this.url}/invio-attivo`, { attivo, versione })
  }

  impostaPasso(passo: string, fatto: boolean, versione: number): Observable<ConfigurazioneSdi> {
    return this.http.put<ConfigurazioneSdi>(`${this.url}/onboarding`, { passo, fatto, versione })
  }
}
