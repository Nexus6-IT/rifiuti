import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

export type LivelloAvvisoCertificato = 'ok' | 'avviso_30' | 'avviso_15' | 'avviso_7' | 'scaduto'

export interface DiagnosticaCertificato {
  configurato: boolean
  scadenza: string | null
  giorniAllaScadenza: number | null
  livelloAvviso: LivelloAvvisoCertificato
}

export interface DiagnosticaTrasmissione {
  id: string
  firId: string
  firNumber: string | null
  status: string
  attempt: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

export type MotivoAttenzioneFormulario = 'PERMANENTLY_FAILED' | 'ATTESA_CONFERMA_LEGAME'

export interface FormularioAttenzione {
  firId: string
  firNumber: string | null
  motivo: MotivoAttenzioneFormulario
  dettaglio: string
}

export interface DiagnosticaLimitatore {
  volumeCorrente: number
  concorrenzaCorrente: number
  inAttesa: boolean
}

export interface RentriDiagnostica {
  certificato: DiagnosticaCertificato
  trasmissioniRecenti: DiagnosticaTrasmissione[]
  formulariAttenzione: FormularioAttenzione[]
  limitatore: DiagnosticaLimitatore
}

/**
 * Client per `GET /rentri/diagnostica` (R5 Task 3): un'UNICA lettura,
 * SOLO su azione esplicita (caricamento pagina o pulsante "Aggiorna").
 * Nessun metodo di questo servizio effettua polling — chi lo usa NON deve
 * mai avvolgerlo in un `interval`/`setInterval`: la diagnostica esiste
 * proprio per non aggiungere traffico automatico oltre a quello già
 * strettamente necessario (v. `RentriDiagnosticaComponent`).
 */
@Injectable({ providedIn: 'root' })
export class RentriDiagnosticaService {
  private readonly API_URL = `${environment.apiUrl}/rentri/diagnostica`

  constructor(private http: HttpClient) {}

  diagnostica(): Observable<RentriDiagnostica> {
    return this.http.get<RentriDiagnostica>(this.API_URL)
  }
}
