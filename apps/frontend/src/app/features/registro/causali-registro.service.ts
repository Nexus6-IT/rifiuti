import { Injectable } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, shareReplay, tap } from 'rxjs'
import { environment } from '../../../environments/environment'
import type { TipoMovimento } from './registro.service'

/** Ruolo della causale nel MUD, come lo espone `GET registro/causali`. */
export type RuoloMudCausale = 'PRODOTTO' | 'AVVIATO' | 'RICEVUTO_DA_TERZI' | 'ESCLUSO'

/** Una causale selezionabile per un tipo di movimento a un giorno (riga di `opzioni`). */
export interface OpzioneCausaleApi {
  codice: string
  descrizione: string
  origine: 'SISTEMA' | 'AZIENDA'
  ruoloMud: RuoloMudCausale | string
  codiceRentri: string | null
  operazione: string | null
  versioneId: string | null
  /** Le registrazioni con questa causale possono avere un legame col listino (4.3). */
  fatturabile?: boolean
}

export interface RispostaOpzioniCausali {
  tipo: TipoMovimento
  data: string
  causali: OpzioneCausaleApi[]
}

/** Verso della causale = tipo di movimento. */
export type VersoCausaleApi = 'CARICO' | 'SCARICO'

/** Causale di sistema nella vista di gestione (solo ADMIN). */
export interface CausaleSistemaGestione {
  codice: string
  verso: VersoCausaleApi
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  /** Sola lettura: il flag delle causali di sistema non cambia per azienda. */
  fatturabile: boolean
  attiva: boolean
  disattivataPerAzienda: boolean
}

/** Una versione di una causale dell'azienda; le date sono giorni 'AAAA-MM-GG'. */
export interface CausaleAziendaleGestione {
  id: string
  codice: string
  verso: VersoCausaleApi
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  fatturabile: boolean
  validaDal: string
  validaAl: string | null
  usata: boolean
  ultimoGiornoUso: string | null
}

export interface GestioneCausali {
  sistema: CausaleSistemaGestione[]
  aziendali: CausaleAziendaleGestione[]
}

export interface DatiNuovaCausale {
  codice: string
  verso: VersoCausaleApi
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri?: string
  operazione?: string
  ordine?: number
  fatturabile?: boolean
  validaDal?: string
}

/** PATCH: campo assente = invariato; null = azzera (solo codiceRentri e operazione). */
export interface DatiModificaCausale {
  descrizione?: string
  ordine?: number
  ruoloMud?: RuoloMudCausale
  codiceRentri?: string | null
  operazione?: string | null
  fatturabile?: boolean
  validaDal?: string
}

export interface DatiNuovaVersione {
  validaDal: string
  ruoloMud: RuoloMudCausale
  codiceRentri?: string
  operazione?: string
  descrizione?: string
  ordine?: number
  fatturabile?: boolean
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

  // --- Gestione (ADMIN): ogni scrittura riuscita invalida la cache delle opzioni ---

  gestione(): Observable<GestioneCausali> {
    return this.http.get<GestioneCausali>(`${this.API_URL}/gestione`)
  }

  disattivaSistema(verso: VersoCausaleApi, codice: string): Observable<void> {
    return this.http.put<void>(this.urlSistema(verso, codice), {}).pipe(tap(() => this.invalida()))
  }

  riattivaSistema(verso: VersoCausaleApi, codice: string): Observable<void> {
    return this.http.delete<void>(this.urlSistema(verso, codice)).pipe(tap(() => this.invalida()))
  }

  crea(dati: DatiNuovaCausale): Observable<CausaleAziendaleGestione> {
    return this.http
      .post<CausaleAziendaleGestione>(`${this.API_URL}/aziendali`, dati)
      .pipe(tap(() => this.invalida()))
  }

  modifica(id: string, dati: DatiModificaCausale): Observable<CausaleAziendaleGestione> {
    return this.http
      .patch<CausaleAziendaleGestione>(`${this.API_URL}/aziendali/${id}`, dati)
      .pipe(tap(() => this.invalida()))
  }

  nuovaVersione(id: string, dati: DatiNuovaVersione): Observable<CausaleAziendaleGestione> {
    return this.http
      .post<CausaleAziendaleGestione>(`${this.API_URL}/aziendali/${id}/versioni`, dati)
      .pipe(tap(() => this.invalida()))
  }

  chiudi(id: string, validaAl: string): Observable<CausaleAziendaleGestione> {
    return this.http
      .put<CausaleAziendaleGestione>(`${this.API_URL}/aziendali/${id}/chiusura`, { validaAl })
      .pipe(tap(() => this.invalida()))
  }

  elimina(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.API_URL}/aziendali/${id}`)
      .pipe(tap(() => this.invalida()))
  }

  private urlSistema(verso: VersoCausaleApi, codice: string): string {
    return `${this.API_URL}/sistema/${verso}/${encodeURIComponent(codice)}/disattivazione`
  }

  /** Svuota la cache: dopo una modifica del catalogo o un 409 `CAUSALE_MODIFICATA`. */
  invalida(): void {
    this.cache.clear()
  }
}
