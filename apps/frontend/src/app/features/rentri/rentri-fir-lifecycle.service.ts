import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Un'operazione RENTRI disponibile ORA su un formulario (v. backend `AzioneTradotta`). */
export interface AzioneRentri {
  operazione: string
  verbo: string
}

export interface AzioniDisponibiliResult {
  stato: string
  versione: number | null
  azioni: AzioneRentri[]
}

/** Payload di `POST /rentri/fir/:id/accettazione` (v. backend `AccettaFirRentriDto`). */
export interface AccettaFirRentriPayload {
  tipoAccettazione: 'A' | 'P' | 'R'
  dataOraArrivo?: string
  quantitaAccettataKg?: number
  causaleRespingimento?: 'NC' | 'IR' | 'A'
  motivoRespingimento?: string
  attesaVerificaAnalitica?: boolean
  correlationId?: string
}

/** Esito della firma remota (unione discriminata, v. backend `EsitoCompletamentoFirma`). */
export type EsitoFirmaRemota =
  | { esito: 'COMPLETATA'; statoFormulario: string }
  | { esito: 'IN_ATTESA'; handle: string; scadenzaAutorizzazione: string }
  | { esito: 'SCADUTA'; handle: string; rilevataDa: 'ente' | 'orologio-locale' }
  | { esito: 'RIFIUTATA'; handle: string }

export interface EsitoAccettaFirRentri {
  tipoAccettazione: 'A' | 'P' | 'R'
  esitoFirma: EsitoFirmaRemota
}

/** Payload di `POST /rentri/fir/:id/annullamento` (v. backend `AnnullaFirRentriDto`). */
export interface AnnullaFirRentriPayload {
  motivo: string
  correlationId?: string
}

export interface EsitoAnnullaFirRentri {
  esitoFirma: EsitoFirmaRemota
  noteInviate: boolean
}

/**
 * Client del ciclo di vita del formulario digitale RENTRI (R3): azioni
 * disponibili e accettazione/respingimento del carico. Backend:
 * `rentri-fir-lifecycle.controller.ts`.
 */
@Injectable({ providedIn: 'root' })
export class RentriFirLifecycleService {
  private readonly API_URL = `${environment.apiUrl}/rentri/fir`

  constructor(private http: HttpClient) {}

  azioniDisponibili(firId: string): Observable<AzioniDisponibiliResult> {
    return this.http.get<AzioniDisponibiliResult>(`${this.API_URL}/${firId}/azioni`)
  }

  accettaORespingi(
    firId: string,
    payload: AccettaFirRentriPayload
  ): Observable<EsitoAccettaFirRentri> {
    return this.http.post<EsitoAccettaFirRentri>(`${this.API_URL}/${firId}/accettazione`, payload)
  }

  annullaFIR(firId: string, payload: AnnullaFirRentriPayload): Observable<EsitoAnnullaFirRentri> {
    return this.http.post<EsitoAnnullaFirRentri>(`${this.API_URL}/${firId}/annullamento`, payload)
  }
}
