import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, map } from 'rxjs'
import { environment } from '../../../environments/environment'

/** Ricevuta di ritiro firmata sul telefono dell'autista (contratto di `GET /esiti-campo/ricevute`). */
export interface RicevutaCampo {
  id: string
  ritiroId: string
  dataRitiro: string
  cliente: string
  cerCode: string
  descrizione: string
  firmatarioNome: string
  /** Orologio del telefono: indicativo, non e' la data legale. */
  firmatoIl: string
  /** Ora del server. */
  ricevutoIl: string
  autista: string
  dimensionePdf: number
  pdfSha256: string
  contenutoSha256: string
  /** `DA_RICONCILIARE`: il ritiro e' cambiato mentre il telefono era offline. */
  esito: 'REGISTRATA' | 'DA_RICONCILIARE'
  motivoConflitto: string | null
  invio: { esito: 'INVIATO' | 'FALLITO'; destinatario: string } | null
}

export interface ElencoRicevuteCampo {
  righe: RicevutaCampo[]
  totale: number
}

export interface PdfScaricato {
  blob: Blob
  nomeFile: string
}

/** Client dell'archivio delle ricevute di ritiro (`/esiti-campo/ricevute`), sola lettura. */
@Injectable({ providedIn: 'root' })
export class RicevuteCampoService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/esiti-campo/ricevute`

  elenca(pagina: number): Observable<ElencoRicevuteCampo> {
    return this.http.get<ElencoRicevuteCampo>(this.base, {
      params: new HttpParams().set('pagina', String(pagina)),
    })
  }

  scarica(id: string): Observable<PdfScaricato> {
    return this.http
      .get(`${this.base}/${encodeURIComponent(id)}/pdf`, {
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((r: HttpResponse<Blob>) => ({
          blob: r.body ?? new Blob([], { type: 'application/pdf' }),
          nomeFile: nomeFileDa(r.headers.get('Content-Disposition')) ?? 'ricevuta-ritiro.pdf',
        }))
      )
  }
}

/** Nome file da `Content-Disposition`; solo caratteri sicuri, altrimenti `null`. */
export function nomeFileDa(intestazione: string | null): string | null {
  const m = /filename="([A-Za-z0-9._-]{1,100})"/.exec(intestazione ?? '')
  return m ? m[1] : null
}
