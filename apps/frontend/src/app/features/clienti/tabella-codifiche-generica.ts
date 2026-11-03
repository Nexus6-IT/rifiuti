import { HttpClient, HttpParams } from '@angular/common/http'
import { Observable, map } from 'rxjs'

/**
 * Rotte comuni delle codifiche (R25): `codifiche-contratto` (4.1) e `codifiche-addebito` (4.2a)
 * hanno lo stesso contratto HTTP e cambiano solo i tipi (generi e forma dei dati).
 */
export class TabellaCodificheGenerica<G extends string, T, N, M> {
  constructor(
    private readonly http: HttpClient,
    private readonly url: string
  ) {}

  list(genere: G, incluseDisattivate = false): Observable<T[]> {
    let params = new HttpParams().set('genere', genere)
    if (incluseDisattivate) params = params.set('incluseDisattivate', 'true')
    return this.http.get<T[]>(this.url, { params })
  }

  /** Informativo: non riserva nulla. */
  prossimoCodice(genere: G): Observable<string> {
    return this.http
      .get<{ codice: string }>(`${this.url}/prossimo-codice`, {
        params: new HttpParams().set('genere', genere),
      })
      .pipe(map(r => r.codice))
  }

  get(id: string): Observable<T> {
    return this.http.get<T>(`${this.url}/${id}`)
  }

  crea(dati: N): Observable<T> {
    return this.http.post<T>(this.url, dati)
  }

  modifica(id: string, dati: M): Observable<T> {
    return this.http.patch<T>(`${this.url}/${id}`, dati)
  }

  elimina(id: string, versione: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`, {
      params: new HttpParams().set('versione', String(versione)),
    })
  }
}
