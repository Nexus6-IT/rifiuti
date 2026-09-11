import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/**
 * Una singola cosa che richiede attenzione oggi, già scritta in italiano
 * pronto da mostrare e con l'azione che porta dove si risolve.
 *
 * Specchio esatto di `VoceAttenzione` nel backend
 * (`apps/backend/src/application/dashboard/raccogli-attenzione.use-case.ts`):
 * stessi nomi di campo, stesso significato.
 */
export interface VoceAttenzione {
  /** 'certificato-rentri', 'autorizzazione', 'scorta-vidimata', ... */
  chiave: string
  gravita: 'critico' | 'avviso' | 'informativo'
  /** Testo italiano già pronto. */
  titolo: string
  /** «scade fra 12 giorni», «nessun blocco attivo». */
  dettaglio: string
  azione?: { etichetta: string; rotta: string }
}

export interface AttenzioneResult {
  voci: VoceAttenzione[]
}

/**
 * Client per le cose che richiedono attenzione oggi nel cruscotto.
 * Backend: GET api/v1/dashboard/attenzione (isolato per tenant).
 */
@Injectable({
  providedIn: 'root',
})
export class AttenzioneService {
  private readonly API_URL = `${environment.apiUrl}/dashboard/attenzione`

  constructor(private http: HttpClient) {}

  /**
   * Ottiene le voci che richiedono attenzione oggi, già ordinate per
   * gravità dal backend (i critici per primi).
   */
  getAttenzione(): Observable<AttenzioneResult> {
    return this.http.get<AttenzioneResult>(this.API_URL)
  }
}
