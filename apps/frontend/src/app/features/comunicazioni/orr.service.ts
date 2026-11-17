import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'
import {
  AnteprimaOrr,
  AttivitaOrr,
  ComunicazioneOrr,
  GeneraOrrRisposta,
  periodoOrr,
} from './orr.model'

/**
 * Client HTTP dell'O.R.R. Campania (4.9f). Il download del file, il manifest e «segna inviata» sono
 * quelli generici di `ComunicazioniService` (`/comunicazioni/:id/...`).
 */
@Injectable({ providedIn: 'root' })
export class OrrService {
  private readonly http = inject(HttpClient)
  private readonly url = `${environment.apiUrl}/comunicazioni/orr`

  anteprima(
    unitaLocaleId: string,
    anno: number,
    meseDa: number,
    meseA: number
  ): Observable<AnteprimaOrr> {
    const { da, a } = periodoOrr(anno, meseDa, meseA)
    const params = new HttpParams().set('unitaLocaleId', unitaLocaleId).set('da', da).set('a', a)
    return this.http.get<AnteprimaOrr>(`${this.url}/anteprima`, { params })
  }

  /** Genera tutti i file del periodo; con un solo errore bloccante il backend non ne genera nessuno. */
  genera(
    unitaLocaleId: string,
    anno: number,
    meseDa: number,
    meseA: number,
    attivita?: AttivitaOrr
  ): Observable<GeneraOrrRisposta> {
    const { da, a } = periodoOrr(anno, meseDa, meseA)
    return this.http.post<GeneraOrrRisposta>(this.url, {
      unitaLocaleId,
      da,
      a,
      ...(attivita ? { attivita } : {}),
    })
  }

  /** Storico dei file della sede; il filtro per anno e' lato client (il backend filtra solo per periodo esatto). */
  storico(unitaLocaleId: string, anno: number): Observable<ComunicazioneOrr[]> {
    const params = new HttpParams().set('unitaLocaleId', unitaLocaleId)
    return this.http
      .get<ComunicazioneOrr[]>(this.url, { params })
      .pipe(map(righe => righe.filter(r => r.periodoDa.startsWith(`${anno}-`))))
  }
}
