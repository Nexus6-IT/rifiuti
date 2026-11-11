import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'
import {
  Consorzio,
  FileScaricato,
  InputRegolaConsorzio,
  MarcaturaMovimento,
  RegolaConsorzio,
  RegoleConsorziRisposta,
} from './consorzi.model'

function nomeFileDa(disposition: string | null): string | null {
  if (!disposition) return null
  const esteso = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (esteso) {
    try {
      return decodeURIComponent(esteso[1].trim())
    } catch {
      /* ripiego sul nome semplice */
    }
  }
  const semplice = /filename="?([^";]+)"?/i.exec(disposition)
  return semplice ? semplice[1].trim() : null
}

/** Client HTTP della marcatura per consorzio (4.9b). Backend: `/comunicazioni/consorzi`. */
@Injectable({ providedIn: 'root' })
export class ConsorziService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/comunicazioni/consorzi`

  regole(): Observable<RegoleConsorziRisposta> {
    return this.http.get<RegoleConsorziRisposta>(`${this.url}/regole`)
  }

  creaRegola(input: InputRegolaConsorzio): Observable<RegolaConsorzio> {
    return this.http.post<RegolaConsorzio>(`${this.url}/regole`, input)
  }

  modificaRegola(id: string, input: InputRegolaConsorzio): Observable<RegolaConsorzio> {
    return this.http.put<RegolaConsorzio>(`${this.url}/regole/${id}`, input)
  }

  eliminaRegola(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/regole/${id}`)
  }

  /** Consorzi di un elenco di movimenti (al massimo 200 per richiesta). */
  consorziDeiMovimenti(ids: string[]): Observable<Record<string, MarcaturaMovimento>> {
    const params = new HttpParams().set('ids', ids.join(','))
    return this.http.get<Record<string, MarcaturaMovimento>>(`${this.url}/movimenti`, { params })
  }

  /** `escluso` false = marcatura manuale, true = esclusione manuale. */
  impostaOverride(
    movimentoId: string,
    consorzio: Consorzio,
    escluso: boolean
  ): Observable<MarcaturaMovimento> {
    return this.http.put<MarcaturaMovimento>(`${this.url}/movimenti/${movimentoId}/${consorzio}`, {
      escluso,
    })
  }

  rimuoviOverride(movimentoId: string, consorzio: Consorzio): Observable<MarcaturaMovimento> {
    return this.http.delete<MarcaturaMovimento>(`${this.url}/movimenti/${movimentoId}/${consorzio}`)
  }

  scaricaEstratto(
    consorzio: Consorzio,
    da: string,
    a: string,
    unitaLocaleId?: string
  ): Observable<FileScaricato> {
    let params = new HttpParams().set('consorzio', consorzio).set('da', da).set('a', a)
    if (unitaLocaleId) params = params.set('unitaLocaleId', unitaLocaleId)
    return this.http
      .get(`${this.url}/estratto`, { params, responseType: 'blob', observe: 'response' })
      .pipe(
        map((r: HttpResponse<Blob>) => ({
          blob: r.body ?? new Blob(),
          nomeFile: nomeFileDa(r.headers.get('Content-Disposition')),
        }))
      )
  }
}
