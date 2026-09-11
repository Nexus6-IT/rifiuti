import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'

/** Blocco virtuale RENTRI (creato SOLO sul portale dell'ente, mai da qui). */
export interface RentriBlocco {
  codiceBlocco: string
  descrizione: string
  numIscrSito: string
  disattivo: boolean
  numeroFirVidimati: number
  dataUltimoUtilizzo: string | null
  predefinito: boolean
}

/** Scorta di numeri già vidimati, pronti all'uso, per blocco. */
export interface RentriScortaPerBlocco {
  codiceBlocco: string
  descrizione: string
  disponibili: number
}

/** Scorta complessiva del tenant. */
export interface RentriScorta {
  totaleDisponibili: number
  perBlocco: RentriScortaPerBlocco[]
}

/** Esito dell'avvio di una vidimazione: NON è immediato, è una richiesta asincrona. */
export interface RentriVidimazioneAvviata {
  avviato: boolean
  richiesti: number
}

/** Esito dell'impostazione del blocco predefinito dell'unità locale. */
export interface RentriBloccoPredefinito {
  codiceBlocco: string
  numIscrSito: string
}

/** Se al momento è possibile emettere un FIR, con motivo pronto all'uso se no. */
export interface RentriEmissionePossibile {
  possibile: boolean
  motivo?: string
  numeriDisponibili: number
}

/**
 * Client per blocchi virtuali RENTRI e scorta di numeri vidimati.
 *
 * I blocchi si creano ESCLUSIVAMENTE sul portale dell'ente (area riservata
 * "Operatori" → Interoperabilità → Gestione blocchi virtuali dei FIR): non
 * esiste — e non deve mai esistere qui — un'API di creazione. Questo client
 * espone solo lettura dei blocchi/scorta e le due azioni realmente possibili
 * da un gestionale: impostare il blocco predefinito e avviare una vidimazione
 * di un lotto di numeri (asincrona: i numeri compaiono in scorta quando
 * l'ente risponde, non alla chiamata).
 */
@Injectable({ providedIn: 'root' })
export class RentriBlocchiService {
  private readonly API_URL = `${environment.apiUrl}/rentri`

  constructor(private http: HttpClient) {}

  blocchi(): Observable<RentriBlocco[]> {
    return this.http
      .get<{ blocchi: RentriBlocco[] }>(`${this.API_URL}/blocchi`)
      .pipe(map(res => res.blocchi))
  }

  scorta(): Observable<RentriScorta> {
    return this.http.get<RentriScorta>(`${this.API_URL}/scorta`)
  }

  vidima(codiceBlocco: string, quantita: number): Observable<RentriVidimazioneAvviata> {
    return this.http.post<RentriVidimazioneAvviata>(`${this.API_URL}/scorta/vidima`, {
      codiceBlocco,
      quantita,
    })
  }

  setPredefinito(codiceBlocco: string): Observable<RentriBloccoPredefinito> {
    return this.http.put<RentriBloccoPredefinito>(
      `${this.API_URL}/blocchi/${codiceBlocco}/predefinito`,
      {}
    )
  }

  emissionePossibile(): Observable<RentriEmissionePossibile> {
    return this.http.get<RentriEmissionePossibile>(`${this.API_URL}/emissione-possibile`)
  }
}
