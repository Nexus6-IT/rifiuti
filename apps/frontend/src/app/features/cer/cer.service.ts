import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { CER, PaginatedCERResponse, CERSearchResult } from '../../shared/models/cer.model'
import { environment } from '../../../environments/environment'

@Injectable({
  providedIn: 'root',
})
export class CerService {
  private readonly API_URL = `${environment.apiUrl}/cer`

  constructor(private http: HttpClient) {}

  /**
   * Ottiene lista paginata di codici CER
   */
  getCERList(page = 1, limit = 50): Observable<PaginatedCERResponse> {
    const params = new HttpParams().set('page', page.toString()).set('limit', limit.toString())

    return this.http.get<PaginatedCERResponse>(this.API_URL, { params })
  }

  /**
   * Ottiene un codice CER per code
   */
  getCERByCode(code: string): Observable<CER> {
    return this.http.get<CER>(`${this.API_URL}/${code}`)
  }

  /**
   * Cerca codici CER per query (per autocomplete)
   */
  searchCER(query: string): Observable<CERSearchResult[]> {
    const params = new HttpParams().set('q', query)
    return this.http.get<CERSearchResult[]>(`${this.API_URL}/search`, { params })
  }

  /**
   * Filtra CER per categoria
   */
  getCERByCategory(category: string, page = 1, limit = 50): Observable<PaginatedCERResponse> {
    const params = new HttpParams()
      .set('category', category)
      .set('page', page.toString())
      .set('limit', limit.toString())

    return this.http.get<PaginatedCERResponse>(this.API_URL, { params })
  }

  /**
   * Ottiene solo CER pericolosi
   */
  getCERPericolosi(page = 1, limit = 50): Observable<PaginatedCERResponse> {
    const params = new HttpParams()
      .set('pericoloso', 'true')
      .set('page', page.toString())
      .set('limit', limit.toString())

    return this.http.get<PaginatedCERResponse>(this.API_URL, { params })
  }

  /**
   * Ottiene tutte le categorie disponibili
   */
  getCategories(): Observable<string[]> {
    return this.http.get<string[]>(`${this.API_URL}/categories`)
  }
}
