/**
 * Client HTTP delle esportazioni XML firmate del registro (eREGI E6/E7).
 * Backend: `rentri/registro/registri/:id/esportazioni` e `rentri/registro/esportazioni/:id/...`.
 */
import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpResponse } from '@angular/common/http'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { environment } from '../../../environments/environment'

export type StatoEsportazione =
  | 'GENERATA'
  | 'IN_VALIDAZIONE'
  | 'VALIDATA'
  | 'VALIDATA_CON_AVVISI'
  | 'RIFIUTATA'
  | 'VALIDAZIONE_NON_DISPONIBILE'
  | 'SOSTITUITA'

/** Messaggio di validazione di RENTRI: solo codice, tipo e campo (mai dati dell'azienda). */
export interface MessaggioEsportazione {
  codice: string | null
  tipo: 'Errore' | 'Avvertimento'
  campo: string | null
}

export interface EsportazioneRegistro {
  id: string
  anno: number
  progressivoDa: number
  progressivoA: number
  numeroRegistrazioni: number
  dataCreazione: string
  stato: StatoEsportazione
  firmato: boolean
  digestAbbreviato: string | null
  precedenteId: string | null
  messaggi: MessaggioEsportazione[]
  creataDa: string | null
}

export interface ElencoEsportazioni {
  /** Catena viva dalla più recente, poi le sostituite. */
  esportazioni: EsportazioneRegistro[]
  /** Il job mensile automatico è acceso (interruttore e invii attivi). */
  automaticaAttiva: boolean
}

export interface FermataEsportazione {
  anno: number
  progressivo: number
  motivi: string[]
}

export type EsitoGenerazione =
  | {
      esito: 'CREATA'
      esportazione: {
        id: string
        progressivoDa: number
        progressivoA: number
        numeroRegistrazioni: number
        anno: number
      }
      fermataA: FermataEsportazione | null
    }
  | { esito: 'NIENTE_DA_ESPORTARE'; esportazione: { id: string } | null }
  | ({ esito: 'BLOCCATA' } & FermataEsportazione)

export interface EsitoValidazione {
  id: string
  stato: StatoEsportazione
  messaggi: MessaggioEsportazione[]
}

export interface EsitoSostituzione {
  sostituite: number
  ultimaValidaId: string | null
}

export interface FileEsportazione {
  blob: Blob
  nomeFile: string | null
}

function nomeFileDa(disposition: string | null): string | null {
  if (!disposition) return null
  const semplice = /filename="?([^";]+)"?/i.exec(disposition)
  return semplice ? semplice[1].trim() : null
}

@Injectable({ providedIn: 'root' })
export class RentriEsportazioniService {
  private readonly http = inject(HttpClient)
  private readonly base = `${environment.apiUrl}/rentri/registro`

  elenco(registroId: string): Observable<ElencoEsportazioni> {
    return this.http.get<ElencoEsportazioni>(
      `${this.base}/registri/${encodeURIComponent(registroId)}/esportazioni`
    )
  }

  /** Genera la prossima esportazione e la fa validare da RENTRI (201 creata, 200 niente/bloccata). */
  genera(registroId: string): Observable<EsitoGenerazione> {
    return this.http.post<EsitoGenerazione>(
      `${this.base}/registri/${encodeURIComponent(registroId)}/esportazioni`,
      {}
    )
  }

  rivalida(esportazioneId: string): Observable<EsitoValidazione> {
    return this.http.post<EsitoValidazione>(
      `${this.base}/esportazioni/${encodeURIComponent(esportazioneId)}/rivalida`,
      {}
    )
  }

  /** Solo amministratori: segna come sostituite la rifiutata e le successive. */
  sostituisci(esportazioneId: string): Observable<EsitoSostituzione> {
    return this.http.post<EsitoSostituzione>(
      `${this.base}/esportazioni/${encodeURIComponent(esportazioneId)}/sostituisci`,
      {}
    )
  }

  scarica(esportazioneId: string): Observable<FileEsportazione> {
    return this.http
      .get(`${this.base}/esportazioni/${encodeURIComponent(esportazioneId)}/file`, {
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((r: HttpResponse<Blob>) => ({
          blob: r.body ?? new Blob(),
          nomeFile: nomeFileDa(r.headers.get('Content-Disposition')),
        }))
      )
  }
}
