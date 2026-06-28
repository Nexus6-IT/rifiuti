import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FIR, PaginatedFIRResponse, FIRStato } from '../../shared/models/fir.model';
import { environment } from '../../../environments/environment';

export type TipoTratta = 'TERRESTRE' | 'FERROVIARIA' | 'MARITTIMA';

export interface TrasportatoreAggiuntivoDto {
  trasportatoreId: string;
  tipoTratta: TipoTratta;
  ordine: number;
}

export interface CreateFIRDto {
  anno: number;
  produttoreId: string;
  trasportatoreId: string;
  destinatarioId: string;
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoDto[];
  rifiuto: {
    cerCode: string;
    quantitaDichiarata: number;
    unitaMisura: string;
    statoFisico?: string;
  };
}

export interface UpdateFIRDto {
  stato?: FIRStato;
  dataPresaCarico?: string;
  dataConsegna?: string;
  pesoEffettivo?: number;
}

@Injectable({
  providedIn: 'root'
})
export class FirService {
  private readonly API_URL = `${environment.apiUrl}/fir`;

  constructor(private http: HttpClient) {}

  /**
   * Ottiene lista paginata di FIR
   */
  getFIRList(page = 1, limit = 10, stato?: FIRStato): Observable<PaginatedFIRResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (stato) {
      params = params.set('stato', stato);
    }

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params });
  }

  /**
   * Ottiene un FIR per ID
   */
  getFIRById(id: string): Observable<FIR> {
    return this.http.get<FIR>(`${this.API_URL}/${id}`);
  }

  /**
   * Crea nuovo FIR
   */
  createFIR(dto: CreateFIRDto): Observable<FIR> {
    return this.http.post<FIR>(this.API_URL, dto);
  }

  /**
   * Aggiorna FIR esistente
   */
  updateFIR(id: string, dto: UpdateFIRDto): Observable<FIR> {
    return this.http.patch<FIR>(`${this.API_URL}/${id}`, dto);
  }

  /**
   * Emette un FIR (cambia stato da BOZZA a EMESSO)
   */
  emettiFIR(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/emetti`, {});
  }

  /**
   * Prende in carico un FIR (trasportatore)
   */
  presaInCarico(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/presa-in-carico`, {
      dataPresaCarico: new Date().toISOString()
    });
  }

  /**
   * Consegna un FIR (destinatario)
   */
  consegnaFIR(id: string, pesoEffettivo: number): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/consegna`, {
      dataConsegna: new Date().toISOString(),
      pesoEffettivo
    });
  }

  /**
   * Annulla un FIR
   */
  annullaFIR(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/annulla`, {});
  }

  /**
   * Elimina un FIR
   */
  deleteFIR(id: string): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }

  /**
   * Ottiene FIR per produttore
   */
  getFIRByProduttore(produttoreId: string, page = 1, limit = 10): Observable<PaginatedFIRResponse> {
    const params = new HttpParams()
      .set('produttoreId', produttoreId)
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params });
  }

  /**
   * Ottiene FIR per trasportatore
   */
  getFIRByTrasportatore(trasportatoreId: string, page = 1, limit = 10): Observable<PaginatedFIRResponse> {
    const params = new HttpParams()
      .set('trasportatoreId', trasportatoreId)
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params });
  }

  /**
   * Ottiene FIR per destinatario
   */
  getFIRByDestinatario(destinatarioId: string, page = 1, limit = 10): Observable<PaginatedFIRResponse> {
    const params = new HttpParams()
      .set('destinatarioId', destinatarioId)
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params });
  }
}
