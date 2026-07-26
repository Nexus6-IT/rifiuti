import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/**
 * Un formulario trovato su RENTRI (anche creato da una controparte diversa
 * dal tenant), arricchito lato backend con lo stato locale
 * (`giaAgganciatoLocalmente`) — v. `CercaFormulariRENTRIUseCase`.
 */
export interface FormularioTrovato {
  numeroFir: string
  dataEmissione?: string | null
  dataCreazione?: string | null
  identificativoSoggetto?: string | null
  numIscrSito?: string | null
  codiceEer?: string | null
  descrizioneRifiuto?: string | null
  stato?: string | null
  /** La visibilità di questo formulario è già stata acquisita da un'unità locale del tenant. */
  visibilitaGiaAcquisita: boolean
  /** Già agganciato a un FIR di QUESTO tenant: non va riproposto per l'aggancio. */
  giaAgganciatoLocalmente: boolean
  /** Id del FIR locale già agganciato, presente se e solo se `giaAgganciatoLocalmente` è true. */
  firIdLocale?: string
}

export interface RisultatoCercaFormulari {
  risultati: FormularioTrovato[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}

/** Scelta esplicita dell'utente su come agganciare un formulario trovato: mai un default silenzioso. */
export type ModalitaAggancio = { modalita: 'NUOVO' } | { modalita: 'ESISTENTE'; firId: string }

export interface AgganciaFormularioResult {
  firId: string
  numeroFir: string
}

export interface RilasciaLegameResult {
  numeroFirRilasciato: string
}

/**
 * Client per la ricerca e l'aggancio dei formulari RENTRI (R2 Task 8).
 * Backend: `rentri-formulari.controller.ts` (`GET /rentri/formulari`,
 * `POST /rentri/formulari/:numeroFir/aggancia`,
 * `POST /rentri/fir/:id/rilascia-legame-rentri`).
 */
@Injectable({ providedIn: 'root' })
export class RentriFormulariService {
  private readonly API_URL = `${environment.apiUrl}/rentri`

  constructor(private http: HttpClient) {}

  /** Ricerca per il CF del tenant corrente, già noto lato backend: nessun parametro da digitare. */
  cerca(): Observable<RisultatoCercaFormulari> {
    return this.http.get<RisultatoCercaFormulari>(`${this.API_URL}/formulari`)
  }

  aggancia(
    numeroFir: string,
    scelta: ModalitaAggancio,
    opts?: { visibilitaGiaAcquisita?: boolean; correlationId?: string }
  ): Observable<AgganciaFormularioResult> {
    return this.http.post<AgganciaFormularioResult>(
      `${this.API_URL}/formulari/${encodeURIComponent(numeroFir)}/aggancia`,
      {
        ...scelta,
        visibilitaGiaAcquisita: opts?.visibilitaGiaAcquisita ?? false,
        correlationId: opts?.correlationId,
      }
    )
  }

  rilasciaLegame(firId: string, correlationId?: string): Observable<RilasciaLegameResult> {
    return this.http.post<RilasciaLegameResult>(
      `${this.API_URL}/fir/${firId}/rilascia-legame-rentri`,
      { correlationId }
    )
  }
}
