import { HttpErrorResponse } from '@angular/common/http'
import { Observable, from, of } from 'rxjs'

/**
 * Codice `error` del corpo di un errore HTTP 403. Con `responseType: 'blob'` (download) il corpo
 * è un Blob e va letto: senza, il 403 di un download non verrebbe riconosciuto. Il Blob non si
 * consuma leggendolo, quindi il chiamante riceve l'errore originale ancora leggibile.
 */
export function codiceErrore(errore: unknown): Observable<unknown> {
  if (!(errore instanceof HttpErrorResponse)) return of(undefined)
  const corpo: unknown = errore.error
  if (corpo instanceof Blob) {
    if (errore.status !== 403) return of(undefined)
    return from(
      corpo.text().then(
        testo => {
          try {
            return (JSON.parse(testo) as { error?: unknown } | null)?.error
          } catch {
            return undefined
          }
        },
        () => undefined
      )
    )
  }
  return of((corpo as { error?: unknown } | null)?.error)
}
