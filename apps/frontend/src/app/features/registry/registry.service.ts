import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import {
  Produttore,
  Trasportatore,
  Destinatario,
  PaginatedResponse,
  Indirizzo,
} from '../../shared/models/registry.model'
import { environment } from '../../../environments/environment'

export interface CreateProduttoreDto {
  ragioneSociale: string
  partitaIVA: string
  sedeLegale: Indirizzo
  pec?: string
}

export interface CreateTrasportatoreDto {
  ragioneSociale: string
  partitaIVA: string
  sedeLegale: Indirizzo
  numeroIscrizione: string
  pec?: string
}

export interface CreateDestinatarioDto {
  ragioneSociale: string
  partitaIVA: string
  sede: Indirizzo
  numeroAutorizzazione: string
  pec?: string
}

@Injectable({
  providedIn: 'root',
})
export class RegistryService {
  private readonly API_URL = `${environment.apiUrl}/registry`

  constructor(private http: HttpClient) {}

  // ========== PRODUTTORI ==========

  getProduttori(page = 1, limit = 10): Observable<PaginatedResponse<Produttore>> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString())

    return this.http.get<PaginatedResponse<Produttore>>(`${this.API_URL}/produttori`, { params })
  }

  getProduttoreById(id: string): Observable<Produttore> {
    return this.http.get<Produttore>(`${this.API_URL}/produttori/${id}`)
  }

  createProduttore(dto: CreateProduttoreDto): Observable<Produttore> {
    return this.http.post<Produttore>(`${this.API_URL}/produttori`, dto)
  }

  updateProduttore(id: string, dto: Partial<CreateProduttoreDto>): Observable<Produttore> {
    return this.http.patch<Produttore>(`${this.API_URL}/produttori/${id}`, dto)
  }

  deleteProduttore(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/produttori/${id}`)
  }

  // ========== TRASPORTATORI ==========

  getTrasportatori(page = 1, limit = 10): Observable<PaginatedResponse<Trasportatore>> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString())

    return this.http.get<PaginatedResponse<Trasportatore>>(`${this.API_URL}/trasportatori`, {
      params,
    })
  }

  getTrasportatoreById(id: string): Observable<Trasportatore> {
    return this.http.get<Trasportatore>(`${this.API_URL}/trasportatori/${id}`)
  }

  createTrasportatore(dto: CreateTrasportatoreDto): Observable<Trasportatore> {
    return this.http.post<Trasportatore>(`${this.API_URL}/trasportatori`, dto)
  }

  updateTrasportatore(id: string, dto: Partial<CreateTrasportatoreDto>): Observable<Trasportatore> {
    return this.http.patch<Trasportatore>(`${this.API_URL}/trasportatori/${id}`, dto)
  }

  deleteTrasportatore(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/trasportatori/${id}`)
  }

  // ========== DESTINATARI ==========

  getDestinatari(page = 1, limit = 10): Observable<PaginatedResponse<Destinatario>> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString())

    return this.http.get<PaginatedResponse<Destinatario>>(`${this.API_URL}/destinatari`, { params })
  }

  getDestinatarioById(id: string): Observable<Destinatario> {
    return this.http.get<Destinatario>(`${this.API_URL}/destinatari/${id}`)
  }

  createDestinatario(dto: CreateDestinatarioDto): Observable<Destinatario> {
    return this.http.post<Destinatario>(`${this.API_URL}/destinatari`, dto)
  }

  updateDestinatario(id: string, dto: Partial<CreateDestinatarioDto>): Observable<Destinatario> {
    return this.http.patch<Destinatario>(`${this.API_URL}/destinatari/${id}`, dto)
  }

  deleteDestinatario(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/destinatari/${id}`)
  }

  // ========== SEARCH/FILTER ==========

  searchProduttori(query: string): Observable<Produttore[]> {
    const params = new HttpParams().set('q', query)
    return this.http.get<Produttore[]>(`${this.API_URL}/produttori/search`, { params })
  }

  searchTrasportatori(query: string): Observable<Trasportatore[]> {
    const params = new HttpParams().set('q', query)
    return this.http.get<Trasportatore[]>(`${this.API_URL}/trasportatori/search`, { params })
  }

  searchDestinatari(query: string): Observable<Destinatario[]> {
    const params = new HttpParams().set('q', query)
    return this.http.get<Destinatario[]>(`${this.API_URL}/destinatari/search`, { params })
  }
}
