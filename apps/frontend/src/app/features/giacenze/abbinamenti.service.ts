import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Contratto JSON di `/abbinamenti` (backend: `abbinamenti.service.ts`). */
export type ClasseStoccaggio = 'R13' | 'D15'
export type StatoScarico = 'ABBINATO' | 'PARZIALE' | 'NON_ABBINATO' | 'INCOERENTE'
export type StatoCarico = 'APERTO' | 'ESAURITO' | 'INCOERENTE'
export type OrigineRiga = 'AUTOMATICO' | 'MANUALE'

export interface RiferimentoCaricoVista {
  tipo: 'MOVIMENTO' | 'APERTURA'
  /** radice del carico o id della giacenza iniziale */
  id: string
  numero: string | null
  /** `YYYY-MM-DD` */
  giorno: string
}
export interface CaricoVista extends RiferimentoCaricoVista {
  classe: ClasseStoccaggio | null
  quantita: number
  abbinato: number
  residuo: number
  etaGiorni: number | null
  stato: StatoCarico
}
export interface RigaVista {
  carico: RiferimentoCaricoVista
  quantita: number
  origine: OrigineRiga
}
export interface ScaricoVista {
  id: string
  numero: string
  giorno: string
  quantita: number
  classeAttesa: ClasseStoccaggio | null
  abbinato: number
  stato: StatoScarico
  righe: RigaVista[]
}
export interface AmbitoVista {
  cerCode: string
  famiglia: string
  unita: string
  classi: ClasseStoccaggio[]
  carichi: CaricoVista[]
  scarichi: ScaricoVista[]
  differenzeFifo: number
  incoerenze: string[]
}
export interface VistaAbbinamenti {
  registroId: string
  oggi: string
  ambiti: AmbitoVista[]
  puoModificare: boolean
  puoRicalcolare: boolean
}
export interface PropostaScarico {
  scarico: ScaricoVista
  candidati: CaricoVista[]
  proposta: Array<{ carico: RiferimentoCaricoVista; quantita: number }>
  scoperto: number
}
export interface DifferenzaVista {
  scarico: { id: string; numero: string }
  carico: RiferimentoCaricoVista
  persistita: number
  fifo: number
}
export interface RigaDaSalvare {
  caricoId?: string
  giacenzaInizialeId?: string
  quantita: number
}
export interface EsitoSalvataggio {
  scarico: ScaricoVista
  avvisi: string[]
}
export interface RicalcoloRichiesto {
  registroId: string
  cerCode?: string
  modalita: 'NON_ABBINATI' | 'AUTOMATICI'
}
export interface EsitoRicalcolo {
  scarichiAbbinati: number
  righeScritte: number
  righeCancellate: number
  avvisi: string[]
}

@Injectable({ providedIn: 'root' })
export class AbbinamentiService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/abbinamenti`

  vista(registroId: string): Observable<VistaAbbinamenti> {
    return this.http.get<VistaAbbinamenti>(this.base, {
      params: new HttpParams().set('registroId', registroId),
    })
  }

  differenze(registroId: string, cerCode?: string): Observable<DifferenzaVista[]> {
    let params = new HttpParams().set('registroId', registroId)
    if (cerCode) params = params.set('cerCode', cerCode)
    return this.http.get<DifferenzaVista[]>(`${this.base}/differenze`, { params })
  }

  proposta(scaricoId: string): Observable<PropostaScarico> {
    return this.http.get<PropostaScarico>(`${this.base}/scarichi/${scaricoId}/proposta`)
  }

  salva(scaricoId: string, righe: RigaDaSalvare[]): Observable<EsitoSalvataggio> {
    return this.http.put<EsitoSalvataggio>(`${this.base}/scarichi/${scaricoId}`, { righe })
  }

  ricalcola(dati: RicalcoloRichiesto): Observable<EsitoRicalcolo> {
    return this.http.post<EsitoRicalcolo>(`${this.base}/ricalcolo`, dati)
  }
}
