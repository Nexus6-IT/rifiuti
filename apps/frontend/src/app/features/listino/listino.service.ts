import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, map } from 'rxjs'
import { environment } from '../../../environments/environment'
import { Pagina } from '../clienti/clienti.model'
import { Tabella } from '../clienti/tabelle-fatturazione.service'
import {
  Addebito,
  AnteprimaVariazione,
  CodiceIva,
  CodificaAddebito,
  CorpoVariazione,
  DatiAddebito,
  EsitoVariazione,
  FiltroAddebiti,
  GenereCodificaAddebito,
  ModificaAddebito,
  ModificaCodiceIva,
  ModificaCodificaAddebito,
  NuovaCodificaAddebito,
  NuovoCodiceIva,
} from './listino.model'

/** Codifiche di addebito: come `TabellaCodifiche` della 4.1, con i cinque generi del listino. */
export class TabellaCodificheAddebito {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(genere: GenereCodificaAddebito, incluseDisattivate = false): Observable<CodificaAddebito[]> {
    let params = new HttpParams().set('genere', genere)
    if (incluseDisattivate) params = params.set('incluseDisattivate', 'true')
    return this.http.get<CodificaAddebito[]>(this.url, { params })
  }

  /** Informativo: non riserva nulla. */
  prossimoCodice(genere: GenereCodificaAddebito): Observable<string> {
    return this.http
      .get<{ codice: string }>(`${this.url}/prossimo-codice`, {
        params: new HttpParams().set('genere', genere),
      })
      .pipe(map(r => r.codice))
  }

  get(id: string): Observable<CodificaAddebito> {
    return this.http.get<CodificaAddebito>(`${this.url}/${id}`)
  }

  crea(dati: NuovaCodificaAddebito): Observable<CodificaAddebito> {
    return this.http.post<CodificaAddebito>(this.url, dati)
  }

  modifica(id: string, dati: ModificaCodificaAddebito): Observable<CodificaAddebito> {
    return this.http.patch<CodificaAddebito>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}

/** Archivio degli addebiti: elenco paginato `{ elementi, totale }` (R12). */
export class TabellaAddebiti {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(filtro: FiltroAddebiti = {}): Observable<Pagina<Addebito>> {
    let params = new HttpParams()
    for (const [chiave, valore] of Object.entries(filtro)) {
      if (valore !== undefined && valore !== null && valore !== '') {
        params = params.set(chiave, String(valore))
      }
    }
    return this.http.get<Pagina<Addebito>>(this.url, { params })
  }

  /** Informativo: primo codice a cinque cifre libero. */
  prossimoCodice(): Observable<string> {
    return this.http.get<{ codice: string }>(`${this.url}/prossimo-codice`).pipe(map(r => r.codice))
  }

  get(id: string): Observable<Addebito> {
    return this.http.get<Addebito>(`${this.url}/${id}`)
  }

  crea(dati: DatiAddebito): Observable<Addebito> {
    return this.http.post<Addebito>(this.url, dati)
  }

  modifica(id: string, dati: ModificaAddebito): Observable<Addebito> {
    return this.http.patch<Addebito>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }

  anteprimaVariazione(corpo: CorpoVariazione): Observable<AnteprimaVariazione> {
    return this.http.post<AnteprimaVariazione>(`${this.url}/variazioni-prezzi/anteprima`, corpo)
  }

  /** Applica con l'impronta dell'anteprima (R24): risponde col numero dei prezzi aggiornati. */
  applicaVariazione(corpo: CorpoVariazione & { impronta: string }): Observable<EsitoVariazione> {
    return this.http.post<EsitoVariazione>(`${this.url}/variazioni-prezzi`, corpo)
  }
}

@Injectable({ providedIn: 'root' })
export class ListinoService {
  private readonly base = environment.apiUrl

  readonly codiciIva: Tabella<CodiceIva, CodiceIva, NuovoCodiceIva, ModificaCodiceIva>
  readonly codifiche: TabellaCodificheAddebito
  readonly addebiti: TabellaAddebiti

  constructor() {
    const http = inject(HttpClient)
    this.codiciIva = new Tabella(http, `${this.base}/codici-iva`)
    this.codifiche = new TabellaCodificheAddebito(http, `${this.base}/codifiche-addebito`)
    this.addebiti = new TabellaAddebiti(http, `${this.base}/addebiti`)
  }
}
