import { Injectable, inject, signal } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'
import { Pagina } from '../clienti/clienti.model'
import {
  AnteprimaAggiornamento,
  ContatoriLegami,
  CorpoAggiornaPrezzi,
  CorpoAzioneMassa,
  CorpoConferma,
  CorpoEscludi,
  CorpoModificaLegame,
  DatiProposta,
  EsitoAggiornamento,
  EsitoAzioneMassa,
  FiltriLista,
  LegameVista,
  PerimetroAggiornamento,
  PropostaLegame,
  RigaLista,
} from './legami.model'

/** Un metodo per rotta del modulo `legami-movimento` (spec §8.1). Errori: `leggiErroriAzione`. */
@Injectable({ providedIn: 'root' })
export class LegamiService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/legami-movimento`

  /** Sola lettura: non scrive nulla. */
  proposta(dati: DatiProposta): Observable<PropostaLegame> {
    return this.http.post<PropostaLegame>(`${this.url}/proposta`, dati)
  }

  lista(filtri: FiltriLista = {}): Observable<Pagina<RigaLista>> {
    let params = new HttpParams()
    for (const [chiave, valore] of Object.entries(filtri)) {
      if (valore !== undefined && valore !== null && valore !== '') {
        params = params.set(chiave, String(valore))
      }
    }
    return this.http.get<Pagina<RigaLista>>(this.url, { params })
  }

  contatori(): Observable<ContatoriLegami> {
    return this.http.get<ContatoriLegami>(`${this.url}/contatori`)
  }

  /** Movimenti in attesa di un legame: il numero accanto alla voce di menu. */
  readonly daCollegare = signal(0)

  /** Rilegge il contatore (menu e pagina lo chiamano dopo ogni azione); se fallisce torna a 0. */
  aggiornaContatori(): void {
    this.contatori().subscribe({
      next: c => this.daCollegare.set(c.daCollegare),
      error: () => this.daCollegare.set(0),
    })
  }

  dettaglio(id: string): Observable<LegameVista> {
    return this.http.get<LegameVista>(`${this.url}/${id}`)
  }

  /** 404 se la catena non ha un legame. */
  perMovimento(movimentoId: string): Observable<LegameVista> {
    return this.http.get<LegameVista>(
      `${environment.apiUrl}/registro/movimenti/${movimentoId}/legame`
    )
  }

  modifica(id: string, corpo: CorpoModificaLegame): Observable<LegameVista> {
    return this.http.put<LegameVista>(`${this.url}/${id}`, corpo)
  }

  conferma(id: string, corpo: CorpoConferma): Observable<LegameVista> {
    return this.http.post<LegameVista>(`${this.url}/${id}/conferma`, corpo)
  }

  escludi(id: string, corpo: CorpoEscludi): Observable<LegameVista> {
    return this.http.post<LegameVista>(`${this.url}/${id}/escludi`, corpo)
  }

  riammetti(id: string, versione: number): Observable<LegameVista> {
    return this.http.post<LegameVista>(`${this.url}/${id}/riammetti`, { versione })
  }

  azioni(corpo: CorpoAzioneMassa): Observable<EsitoAzioneMassa> {
    return this.http.post<EsitoAzioneMassa>(`${this.url}/azioni`, corpo)
  }

  /** Senza `firma`: il server calcola solo l'anteprima. */
  anteprimaAggiornamento(perimetro: PerimetroAggiornamento): Observable<AnteprimaAggiornamento> {
    const corpo: CorpoAggiornaPrezzi = { perimetro }
    return this.http.post<AnteprimaAggiornamento>(`${this.url}/aggiorna-prezzi`, corpo)
  }

  /** Con la firma dell'anteprima vista: 409 ANTEPRIMA_SUPERATA se nel frattempo è cambiato qualcosa. */
  applicaAggiornamento(
    perimetro: PerimetroAggiornamento,
    firma: string
  ): Observable<EsitoAggiornamento> {
    const corpo: CorpoAggiornaPrezzi = { perimetro, firma }
    return this.http.post<EsitoAggiornamento>(`${this.url}/aggiorna-prezzi`, corpo)
  }

  daMovimento(movimentoId: string): Observable<LegameVista> {
    return this.http.post<LegameVista>(`${this.url}/da-movimento/${movimentoId}`, {})
  }
}
