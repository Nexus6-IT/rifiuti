import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'

import { environment } from '../../../../environments/environment'

/**
 * Stato di una voce della pagina.
 *
 * `unknown` NON e' `ok`: significa «non misurabile con i dati disponibili».
 * La distinzione arriva dal backend ed e' il motivo per cui questa pagina
 * esiste — un pallino verde che vuol dire «non lo so» e' peggio di nessun
 * pallino.
 */
export type HealthState = 'ok' | 'warn' | 'error' | 'off' | 'info' | 'unknown'

export interface HealthItem {
  key: string
  label: string
  state: HealthState
  /** Timestamp ISO dell'ultimo evento noto, `null` se non misurabile. */
  since: string | null
  /** Prova testuale dello stato: numeri, non aggettivi. */
  detail: string
  /** True solo per le voci dietro a un job realmente rilanciabile. */
  actionable?: boolean
  actionKey?: string | null
}

export interface SystemHealth {
  generatedAt: string
  cached: boolean
  cacheAgeSeconds: number
  infrastructure: HealthItem[]
  queues: HealthItem[]
  scheduledJobs: HealthItem[]
  freshness: HealthItem[]
  credentials: HealthItem[]
  flags: HealthItem[]
}

/** Risposta dell'avvio manuale: AVVIATO, non «eseguito» (202 dal backend). */
export interface EsitoAvvioJob {
  jobKey: string
  stato: 'avviato'
  messaggio: string
  avviatoAl: string
}

export interface EventoAuditJob {
  jobKey: string
  esito: string
  descrizione: string
  utente: string | null
  al: string
}

/**
 * Client HTTP di `admin/system-health` (prefix globale /api/v1 gia' in
 * `apiUrl`). L'interceptor condiviso aggiunge il Bearer; l'endpoint e'
 * comunque protetto lato server (JwtAuthGuard + RolesGuard SUPER_ADMIN).
 */
@Injectable({ providedIn: 'root' })
export class SystemHealthService {
  private readonly http = inject(HttpClient)
  private readonly API_URL = `${environment.apiUrl}/admin/system-health`

  stato(): Observable<SystemHealth> {
    return this.http.get<SystemHealth>(this.API_URL)
  }

  avviaJob(actionKey: string): Observable<EsitoAvvioJob> {
    return this.http.post<EsitoAvvioJob>(
      `${this.API_URL}/actions/${encodeURIComponent(actionKey)}/run`,
      {}
    )
  }

  storico(limite = 20): Observable<EventoAuditJob[]> {
    return this.http.get<EventoAuditJob[]>(`${this.API_URL}/actions/audit`, {
      params: new HttpParams().set('limit', String(limite)),
    })
  }
}
