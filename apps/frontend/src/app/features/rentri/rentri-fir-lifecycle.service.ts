import { Injectable } from '@angular/core'
import { HttpClient, HttpResponse } from '@angular/common/http'
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
  | {
      esito: 'SCADUTA'
      handle: string
      rilevataDa: 'ente' | 'orologio-locale'
      dettaglioEnte?: string
    }
  | { esito: 'RIFIUTATA'; handle: string; dettaglioEnte?: string }

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
 * Payload di `POST /rentri/fir/:id/allegati` (v. backend
 * `CaricaAllegatoFirRentriDto`). NON porta `identificativoSoggetto`: il
 * backend lo risolve dal codice fiscale del tenant (v.
 * `GestisciAllegatiFIRUseCase`), non un valore che il frontend deve conoscere.
 */
export interface CaricaAllegatoFirRentriPayload {
  nomeFile: string
  contentType: string
  contenutoBase64: string
  correlationId?: string
}

/** Riga locale di un allegato (v. backend `AllegatoFIR`). */
export interface AllegatoFirRentri {
  id: string
  rentriAllegatoId: number
  filename: string
  mimeType: string
  sizeBytes: number
  caricatoDa: string
  caricatoAlle: string
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

  /** Elenco locale (mai una chiamata a RENTRI, v. backend). */
  elencaAllegati(firId: string): Observable<AllegatoFirRentri[]> {
    return this.http.get<AllegatoFirRentri[]>(`${this.API_URL}/${firId}/allegati`)
  }

  caricaAllegato(
    firId: string,
    payload: CaricaAllegatoFirRentriPayload
  ): Observable<AllegatoFirRentri> {
    return this.http.post<AllegatoFirRentri>(`${this.API_URL}/${firId}/allegati`, payload)
  }

  eliminaAllegato(firId: string, allegatoId: string): Observable<{ eliminato: true }> {
    return this.http.delete<{ eliminato: true }>(`${this.API_URL}/${firId}/allegati/${allegatoId}`)
  }

  /**
   * Scarica il PDF del formulario (R3 Task 7): il backend fa da TRAMITE
   * (scarica da RENTRI e trasmette lo stream), mai un redirect al portale —
   * per questo la risposta è `blob`, non un URL da aprire in una nuova
   * scheda. `observe: 'response'` per leggere `Content-Disposition` (nome
   * file suggerito dall'ente) invece di indovinarlo lato client.
   */
  scaricaPdf(firId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.API_URL}/${firId}/pdf`, {
      responseType: 'blob',
      observe: 'response',
    })
  }
}
