import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Autista dell'anagrafica (app campo): date `AAAA-MM-GG`. */
export interface Autista {
  id: string
  nome: string
  cognome: string
  codiceFiscale: string | null
  trasportatoreId: string | null
  patenteNumero: string | null
  patenteCategoria: string | null
  patenteScadenza: string | null
  cqcScadenza: string | null
  adrScadenza: string | null
  telefono: string | null
  /** Utente con ruolo autista con cui entra nell'app. */
  userId: string | null
  attivo: boolean
}

export interface DatiAutista {
  nome: string
  cognome: string
  codiceFiscale?: string | null
  trasportatoreId?: string | null
  patenteNumero?: string | null
  patenteCategoria?: string | null
  patenteScadenza?: string | null
  cqcScadenza?: string | null
  adrScadenza?: string | null
  telefono?: string | null
  userId?: string | null
  attivo?: boolean
}

export interface ElencoAutisti {
  righe: Autista[]
  /** Lo decide il backend sul ruolo effettivo nell'azienda selezionata. */
  puoOperare: boolean
}

/** Client dell'anagrafica autisti (`/autisti`). */
@Injectable({ providedIn: 'root' })
export class AutistiService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/autisti`

  elenca(soloAttivi = false): Observable<ElencoAutisti> {
    let params = new HttpParams()
    if (soloAttivi) params = params.set('attivi', 'true')
    return this.http.get<ElencoAutisti>(this.base, { params })
  }

  crea(dati: DatiAutista): Observable<Autista> {
    return this.http.post<Autista>(this.base, dati)
  }

  aggiorna(id: string, dati: DatiAutista): Observable<Autista> {
    return this.http.put<Autista>(`${this.base}/${id}`, dati)
  }
}

/** «Cognome Nome»: lo stesso ordine del backend nella vista dei ritiri e nella distinta. */
export const nomeAutista = (a: Pick<Autista, 'nome' | 'cognome'>): string =>
  `${a.cognome} ${a.nome}`
