import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import {
  AnagraficaComunicazioni,
  AnagraficaComunicazioniRisposta,
  ConfigurazioneComunicazioni,
  ConfigurazioneComunicazioniRisposta,
  ConsorzioConfigurabile,
  DatiMovimento,
  DatiMovimentoRisposta,
  DatiTracciatoVista,
  InputAnagraficaComunicazioni,
  TracciatoDati,
} from './dati-comunicazioni.model'

/** Client HTTP dei dati dei tracciati (4.9c-f). Backend: `/comunicazioni/dati`. */
@Injectable({ providedIn: 'root' })
export class DatiComunicazioniService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/comunicazioni/dati`

  datiMovimento(movimentoId: string, tracciato: TracciatoDati): Observable<DatiMovimentoRisposta> {
    return this.http.get<DatiMovimentoRisposta>(`${this.url}/movimenti/${movimentoId}/${tracciato}`)
  }

  impostaDatiMovimento(
    movimentoId: string,
    tracciato: TracciatoDati,
    dati: DatiMovimento
  ): Observable<DatiTracciatoVista> {
    return this.http.put<DatiTracciatoVista>(
      `${this.url}/movimenti/${movimentoId}/${tracciato}`,
      dati
    )
  }

  cancellaDatiMovimento(movimentoId: string, tracciato: TracciatoDati): Observable<void> {
    return this.http.delete<void>(`${this.url}/movimenti/${movimentoId}/${tracciato}`)
  }

  anagraficaSede(sedeDittaId: string): Observable<AnagraficaComunicazioniRisposta> {
    return this.http.get<AnagraficaComunicazioniRisposta>(`${this.url}/sedi-ditta/${sedeDittaId}`)
  }

  impostaAnagraficaSede(
    sedeDittaId: string,
    input: InputAnagraficaComunicazioni
  ): Observable<AnagraficaComunicazioni> {
    return this.http.put<AnagraficaComunicazioni>(`${this.url}/sedi-ditta/${sedeDittaId}`, input)
  }

  configurazione(
    unitaLocaleId: string,
    consorzio: ConsorzioConfigurabile
  ): Observable<ConfigurazioneComunicazioniRisposta> {
    return this.http.get<ConfigurazioneComunicazioniRisposta>(
      `${this.url}/sedi/${unitaLocaleId}/${consorzio}`
    )
  }

  impostaConfigurazione(
    unitaLocaleId: string,
    consorzio: ConsorzioConfigurabile,
    dati: Record<string, unknown>
  ): Observable<ConfigurazioneComunicazioni> {
    return this.http.put<ConfigurazioneComunicazioni>(
      `${this.url}/sedi/${unitaLocaleId}/${consorzio}`,
      dati
    )
  }
}
