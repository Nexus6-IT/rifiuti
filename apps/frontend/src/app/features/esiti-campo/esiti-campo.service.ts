import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

export type EsitoEventoCampo = 'APPLICATO' | 'DA_RICONCILIARE'
export type TipoEventoCampo = 'RITIRO_ESEGUITO' | 'RITIRO_NON_ESEGUITO'

/** Esito inviato da un autista dall'app campo (contratto di `GET /esiti-campo`). */
export interface EsitoCampo {
  id: string
  tipo: TipoEventoCampo
  esito: EsitoEventoCampo
  motivoConflitto: string | null
  dati: { motivo?: string; nota?: string }
  versioneVista: number
  /** Orologio del telefono: indicativo, non e' la data legale. */
  rilevatoIl: string
  ricevutoIl: string
  autista: { id: string; nome: string }
  ritiro: {
    id: string
    dataPrevista: string
    produttore: string
    cerCode: string
    descrizione: string
    stato: string
    versione: number
  }
}

export interface ElencoEsitiCampo {
  righe: EsitoCampo[]
  totale: number
}

/** Perche' un esito e' «da riconciliare», in italiano. */
export function spiegaConflitto(motivo: string | null): string {
  switch (motivo) {
    case 'RITIRO_ANNULLATO':
      return 'Il ritiro è stato annullato in ufficio prima dell’invio.'
    case 'RITIRO_MODIFICATO':
      return 'Il ritiro è stato modificato in ufficio dopo che l’autista lo aveva visto: l’esito non è stato applicato.'
    case 'RITIRO_RIASSEGNATO':
      return 'Il ritiro non è assegnato a questo autista (riassegnato o senza autista).'
    case 'RITIRO_STATO_CAMBIATO':
      return 'Il ritiro era già stato chiuso o riprogrammato in ufficio.'
    case 'RITIRO_CON_FIR':
      return 'Il ritiro ha già un FIR attivo: l’esito non è stato applicato.'
    case 'ESITO_GIA_REGISTRATO':
      return 'Per questo ritiro risulta già un esito dal campo: questo è un duplicato o una contraddizione.'
    default:
      return 'Serve un controllo in ufficio.'
  }
}

/** Client di «Esiti dal campo» (`/esiti-campo`), sola lettura. */
@Injectable({ providedIn: 'root' })
export class EsitiCampoService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/esiti-campo`

  elenca(esito: EsitoEventoCampo | null, pagina: number): Observable<ElencoEsitiCampo> {
    let params = new HttpParams().set('pagina', String(pagina))
    if (esito) params = params.set('esito', esito)
    return this.http.get<ElencoEsitiCampo>(this.base, { params })
  }
}
