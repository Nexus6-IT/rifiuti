import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FIR, PaginatedFIRResponse, FIRStato, FirmaApplicativa } from '../../shared/models/fir.model';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

export type TipoTratta = 'TERRESTRE' | 'FERROVIARIA' | 'MARITTIMA';

export interface TrasportatoreAggiuntivoDto {
  trasportatoreId: string;
  tipoTratta: TipoTratta;
  ordine: number;
}

export interface CreateFIRDto {
  produttoreId: string;
  trasportatoreId: string;
  destinatarioId: string;
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoDto[];
  rifiuto: {
    cerCode: string;
    quantita: number;
    unitaMisura: string;
    statoFisico?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class FirService {
  private readonly API_URL = `${environment.apiUrl}/fir`;
  private readonly auth = inject(AuthService);

  constructor(private http: HttpClient) {}

  /**
   * Costruisce la firma applicativa (NON qualificata) a partire dall'utente
   * loggato. La firma digitale qualificata è un sottosistema separato e fuori
   * scope: qui si traccia solo chi ha eseguito la transizione applicativa.
   */
  private buildFirma(): FirmaApplicativa {
    const user = this.auth.currentUser();
    const nome = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
      : '';
    const firmatario = nome || user?.email || 'Operatore';
    return { firmatario, certificato: 'FIRMA-NON-QUALIFICATA' };
  }

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
   * Crea nuovo FIR (stato BOZZA)
   */
  createFIR(dto: CreateFIRDto): Observable<FIR> {
    return this.http.post<FIR>(this.API_URL, dto);
  }

  /**
   * Emette un FIR: BOZZA → EMESSO (assegna il numero progressivo).
   * Allega la firma applicativa del produttore.
   */
  emettiFIR(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/emetti`, {
      firmaProduttore: this.buildFirma()
    });
  }

  /**
   * Presa in carico (trasportatore): EMESSO → IN_TRANSITO.
   */
  presaInCarico(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/presa-in-carico`, {
      firmaTrasportatore: this.buildFirma()
    });
  }

  /**
   * Conferma consegna (destinatario): IN_TRANSITO → CONSEGNATO.
   * Richiede il peso effettivo (kg) rilevato a destinazione.
   */
  confermaConsegna(id: string, pesoEffettivo: number): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/conferma-consegna`, {
      pesoEffettivo,
      firmaDestinatario: this.buildFirma()
    });
  }

  /**
   * Annulla un FIR: qualsiasi stato tranne CONSEGNATO → ANNULLATO.
   */
  annullaFIR(id: string, motivo: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/annulla`, { motivo });
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
