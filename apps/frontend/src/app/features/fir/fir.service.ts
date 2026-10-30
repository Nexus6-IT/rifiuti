import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { FIR, PaginatedFIRResponse, FIRStato } from '../../shared/models/fir.model'
import { environment } from '../../../environments/environment'

export type TipoTratta = 'TERRESTRE' | 'FERROVIARIA' | 'MARITTIMA'

/** Provenienza del rifiuto — richiesta dal contratto RENTRI (Campo 1 FIR). */
export type ProvenienzaRifiuto = 'URBANO' | 'SPECIALE'

export interface TrasportatoreAggiuntivoDto {
  trasportatoreId: string
  tipoTratta: TipoTratta
  ordine: number
}

export interface CreateFIRDto {
  produttoreId: string
  trasportatoreId: string
  destinatarioId: string
  /** Sede del produttore: solo se l'utente l'ha cambiata (altrimenti vale la predefinita del ruolo o quella del FIR). */
  produttoreSedeId?: string
  /** Sede del destinatario: solo se l'utente l'ha cambiata. */
  destinatarioSedeId?: string
  /** Provenienza del rifiuto (Urbano/Speciale) — obbligatoria per la trasmissione RENTRI. */
  provenienza?: ProvenienzaRifiuto
  /** Modalità di trasporto della tratta principale — obbligatoria per la trasmissione RENTRI. */
  tipoTrattaPrincipale?: TipoTratta
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoDto[]
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura: string
    /** Campo 2 FIR: stato fisico del rifiuto (DM 59/2023). */
    statoFisico?: string
    /** Campo 2 FIR: caratteristiche HP (Reg. UE 1357/2014), comma-separated. */
    caratteristichePericolo?: string
    /** Campo 2 FIR: numero di colli. */
    numeroColli?: number
    /** Campo 3 FIR: codice operazione R/D specifico (es. "R13", "D1"). */
    codiceOperazione?: string
  }
  /** Campo 17 FIR (DM 59/2023): annotazioni libere. */
  annotazioni?: string
}

/**
 * Corpo di `PUT /fir/:id`: tutti i campi della creazione più la `versione` letta
 * (controllo ottimistico). Qui `rifiuto.unitaMisura` è obbligatoria: il backend non
 * applica il predefinito della creazione, per non cambiare l'unità senza che l'utente lo sappia.
 */
export interface ModificaFIRDto extends Omit<CreateFIRDto, 'rifiuto'> {
  rifiuto: CreateFIRDto['rifiuto'] & { unitaMisura: string }
  versione: number
}

@Injectable({
  providedIn: 'root',
})
export class FirService {
  private readonly API_URL = `${environment.apiUrl}/fir`

  constructor(private http: HttpClient) {}

  /**
   * Ottiene lista paginata di FIR
   */
  getFIRList(page = 1, limit = 10, stato?: FIRStato): Observable<PaginatedFIRResponse> {
    let params = new HttpParams().set('page', page.toString()).set('limit', limit.toString())

    if (stato) {
      params = params.set('stato', stato)
    }

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params })
  }

  /**
   * Ottiene un FIR per ID
   */
  getFIRById(id: string): Observable<FIR> {
    return this.http.get<FIR>(`${this.API_URL}/${id}`)
  }

  /**
   * Crea nuovo FIR (stato BOZZA)
   */
  createFIR(dto: CreateFIRDto): Observable<FIR> {
    return this.http.post<FIR>(this.API_URL, dto)
  }

  /**
   * Modifica una bozza (PUT). 409 `FIR_MODIFICATO_NEL_FRATTEMPO` se la versione è superata,
   * 409 `FIR_NON_MODIFICABILE` se nel frattempo non è più una bozza modificabile.
   */
  modificaFIR(id: string, dto: ModificaFIRDto): Observable<FIR> {
    return this.http.put<FIR>(`${this.API_URL}/${id}`, dto)
  }

  /**
   * Emette un FIR: BOZZA → EMESSO (assegna il numero progressivo).
   * La firma del produttore NON è costruita dal frontend: il backend la
   * produce invocando il sottosistema crittografico e la persiste (task 4,
   * pipeline P3). Il frontend chiede solo di firmare, non firma da sé.
   */
  emettiFIR(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/emetti`, {})
  }

  /**
   * Presa in carico (trasportatore): EMESSO → IN_TRANSITO.
   * La firma del trasportatore è prodotta dal backend (vedi emettiFIR).
   */
  presaInCarico(id: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/presa-in-carico`, {})
  }

  /**
   * Conferma consegna (destinatario): IN_TRANSITO → CONSEGNATO.
   * Richiede il peso effettivo rilevato a destinazione, nell'unità di misura del FIR.
   * La firma del destinatario è prodotta dal backend (vedi emettiFIR).
   */
  confermaConsegna(id: string, pesoEffettivo: number): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/conferma-consegna`, {
      pesoEffettivo,
    })
  }

  /**
   * Annulla un FIR: qualsiasi stato tranne CONSEGNATO → ANNULLATO.
   */
  annullaFIR(id: string, motivo: string): Observable<FIR> {
    return this.http.post<FIR>(`${this.API_URL}/${id}/annulla`, { motivo })
  }

  /**
   * Ottiene FIR per produttore
   */
  getFIRByProduttore(produttoreId: string, page = 1, limit = 10): Observable<PaginatedFIRResponse> {
    const params = new HttpParams()
      .set('produttoreId', produttoreId)
      .set('page', page.toString())
      .set('limit', limit.toString())

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params })
  }

  /**
   * Ottiene FIR per trasportatore
   */
  getFIRByTrasportatore(
    trasportatoreId: string,
    page = 1,
    limit = 10
  ): Observable<PaginatedFIRResponse> {
    const params = new HttpParams()
      .set('trasportatoreId', trasportatoreId)
      .set('page', page.toString())
      .set('limit', limit.toString())

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params })
  }

  /**
   * Ottiene FIR per destinatario
   */
  getFIRByDestinatario(
    destinatarioId: string,
    page = 1,
    limit = 10
  ): Observable<PaginatedFIRResponse> {
    const params = new HttpParams()
      .set('destinatarioId', destinatarioId)
      .set('page', page.toString())
      .set('limit', limit.toString())

    return this.http.get<PaginatedFIRResponse>(this.API_URL, { params })
  }
}
