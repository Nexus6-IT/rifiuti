import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, shareReplay } from 'rxjs'
import { environment } from '../../../environments/environment'
import type { TipoMovimento } from './registro.service'

/** Ruolo della causale nel MUD, come lo espone `GET registro/causali`. */
export type RuoloMudCausale = 'PRODUZIONE' | 'RICEVUTO' | 'RECUPERO' | 'SMALTIMENTO' | 'ESCLUSO'

/** Una causale selezionabile per un tipo di movimento a un giorno (riga di `opzioni`). */
export interface OpzioneCausaleApi {
  codice: string
  descrizione: string
  origine: 'SISTEMA' | 'AZIENDA'
  ruoloMud: RuoloMudCausale | string
  codiceRentri: string | null
  operazione: string | null
  versioneId: string | null
}

export interface RispostaOpzioniCausali {
  tipo: TipoMovimento
  data: string
  causali: OpzioneCausaleApi[]
}

/**
 * Causali del registro (F2-5). Le opzioni di un tipo a un giorno vengono dall'API e si tengono
 * in cache per `(tipo, giorno)`: cambiare data avanti e indietro non rifa la richiesta.
 * Ogni modifica del catalogo (gestione) e ogni 409 `CAUSALE_MODIFICATA` invalida la cache.
 */
@Injectable({ providedIn: 'root' })
export class CausaliRegistroService {
  private readonly API_URL = `${environment.apiUrl}/registro/causali`
  private readonly cache = new Map<string, Observable<OpzioneCausaleApi[]>>()

  constructor(private readonly http: HttpClient) {}

  /**
   * Causali selezionabili per `tipo` al `giorno` ('AAAA-MM-GG', senza spostamenti di fuso;
   * senza giorno decide il backend: oggi). Le richieste fallite non restano in cache.
   */
  opzioni(tipo: TipoMovimento, giorno?: string): Observable<OpzioneCausaleApi[]> {
    const chiave = `${tipo}|${giorno ?? ''}`
    const inCache = this.cache.get(chiave)
    if (inCache) return inCache
    let params = new HttpParams().set('tipo', tipo)
    if (giorno) params = params.set('data', giorno)
    const richiesta = new Observable<OpzioneCausaleApi[]>(osservatore => {
      const sub = this.http.get<RispostaOpzioniCausali>(this.API_URL, { params }).subscribe({
        next: r => {
          osservatore.next(r.causali)
          osservatore.complete()
        },
        error: err => {
          // un errore non deve restare in cache: il tentativo successivo rifa la richiesta
          if (this.cache.get(chiave) === condiviso) this.cache.delete(chiave)
          osservatore.error(err)
        },
      })
      return () => sub.unsubscribe()
    })
    const condiviso = richiesta.pipe(shareReplay({ bufferSize: 1, refCount: false }))
    this.cache.set(chiave, condiviso)
    return condiviso
  }

  /** Svuota la cache: dopo una modifica del catalogo o un 409 `CAUSALE_MODIFICATA`. */
  invalida(): void {
    this.cache.clear()
  }
}
