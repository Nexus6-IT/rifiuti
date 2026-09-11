import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/**
 * Conteggio dei formulari creati in un dato mese ('YYYY-MM'). Etichetta
 * "creati" (non "emessi", ruling PO giro di revisione 1): il backend conta
 * per data di creazione perché non esiste un campo "data di emissione"
 * persistito — v. `raccogli-andamento-mensile.use-case.ts` sul backend.
 */
export interface AndamentoMensileVoce {
  mese: string
  conteggio: number
}

export interface AndamentoMensileResult {
  mesi: AndamentoMensileVoce[]
}

/**
 * Client per l'andamento mensile dei formulari creati (Task 4 del piano
 * cruscotto). Backend: GET api/v1/dashboard/andamento (isolato per tenant).
 */
@Injectable({
  providedIn: 'root',
})
export class AndamentoService {
  private readonly API_URL = `${environment.apiUrl}/dashboard/andamento`

  constructor(private http: HttpClient) {}

  /** Ottiene i 12 mesi (dal più vecchio al più recente) già ordinati dal backend. */
  getAndamento(): Observable<AndamentoMensileResult> {
    return this.http.get<AndamentoMensileResult>(this.API_URL)
  }
}
