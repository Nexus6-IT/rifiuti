import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'

import { environment } from '../../../../environments/environment'

export type EsitoVoce = 'OK' | 'DIFFERENZA'
export type EsitoConfronto = 'OK' | 'DIFFERENZE' | 'NON_APPLICABILE' | 'NON_VERIFICATO'
export type EsitoCampione = 'CORRISPONDE' | 'NON_CORRISPONDE'

export interface VoceConfronto {
  chiave: string
  descrizione: string
  sorgente: number | string | null
  destinazione: number | string | null
  esito: EsitoVoce
}

export interface ConfrontoRiconciliazione {
  numero: 1 | 2 | 3 | 4 | 5
  titolo: string
  esito: EsitoConfronto
  nota?: string
  voci: VoceConfronto[]
}

export interface Accettazione {
  motivo: string
  da: string
  il: string
}

export interface CampioneRiga {
  id: string
  tipo: 'MOVIMENTO' | 'FIR'
  riferimentoId: string
  legacyKey: string | null
  esito: EsitoCampione | null
  nota: string | null
}

export interface ValutazioneChiusura {
  chiudibile: boolean
  differenzeAperte: string[]
  campioniSenzaEsito: number
  campioniNonCorrispondono: number
}

export interface RapportoRiconciliazione {
  id: string
  radiceId: string
  versione: number
  stato: 'APERTO' | 'CHIUSO'
  lottiImportIds: string[]
  esiti: {
    archivioSorgente: string
    confronti: ConfrontoRiconciliazione[]
    campione: { seme: string; richiesti: number; movimenti: number; fir: number }
    accettazioni: Record<string, Accettazione>
  }
  hashRapporto: string
  chiusoIl: string | null
  campioni: CampioneRiga[]
  verbali: Array<{
    id: string
    versioneRapporto: number
    nomeFile: string
    dimensione: number
    sha256: string
    createdAt: string
  }>
  valutazione: ValutazioneChiusura
}

export interface RiepilogoRapporto {
  radiceId: string
  versione: number
  stato: 'APERTO' | 'CHIUSO'
  archivio: string
  lottiImportIds: string[]
  creatoIl: string
  chiudibile: boolean
  differenzeAperte: number
  campioniSenzaEsito: number
  verbali: number
}

/**
 * Client HTTP di `admin/import/rapporti` (SUPER_ADMIN; prefix globale gia' in `apiUrl`). L'azienda si
 * indica sempre: il backend esegue ogni operazione nel suo contesto, con la sua RLS.
 */
@Injectable({ providedIn: 'root' })
export class RiconciliazioneImportService {
  private readonly http = inject(HttpClient)
  private readonly API_URL = `${environment.apiUrl}/admin/import/rapporti`

  elenca(tenantId: string): Observable<RiepilogoRapporto[]> {
    return this.http.get<RiepilogoRapporto[]>(this.API_URL, {
      params: new HttpParams().set('tenantId', tenantId),
    })
  }

  leggi(tenantId: string, radiceId: string): Observable<RapportoRiconciliazione> {
    return this.http.get<RapportoRiconciliazione>(`${this.API_URL}/${radiceId}`, {
      params: new HttpParams().set('tenantId', tenantId),
    })
  }

  esitoCampione(
    tenantId: string,
    radiceId: string,
    campioneId: string,
    esito: EsitoCampione,
    nota?: string
  ): Observable<void> {
    return this.http.post<void>(`${this.API_URL}/${radiceId}/campioni/${campioneId}/esito`, {
      tenantId,
      esito,
      nota,
    })
  }

  accetta(
    tenantId: string,
    radiceId: string,
    versione: number,
    chiave: string,
    motivo: string
  ): Observable<RapportoRiconciliazione> {
    return this.http.post<RapportoRiconciliazione>(
      `${this.API_URL}/${radiceId}/differenze/accetta`,
      {
        tenantId,
        versione,
        chiave,
        motivo,
      }
    )
  }

  chiudi(
    tenantId: string,
    radiceId: string,
    versione: number
  ): Observable<RapportoRiconciliazione> {
    return this.http.post<RapportoRiconciliazione>(`${this.API_URL}/${radiceId}/chiudi`, {
      tenantId,
      versione,
    })
  }

  caricaVerbale(
    tenantId: string,
    radiceId: string,
    versione: number,
    file: File
  ): Observable<RapportoRiconciliazione> {
    return this.http.post<RapportoRiconciliazione>(`${this.API_URL}/${radiceId}/verbale`, file, {
      headers: { 'Content-Type': 'application/pdf' },
      params: new HttpParams()
        .set('tenantId', tenantId)
        .set('versione', String(versione))
        .set('nomeFile', file.name),
    })
  }
}
