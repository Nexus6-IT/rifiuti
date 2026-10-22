import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { InjectionToken, inject } from '@angular/core'
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'
import { environment } from '../../../environments/environment'

/** Codice d'errore del backend per un'azienda selezionata non più accessibile. */
const AZIENDA_SELEZIONATA_NON_ACCESSIBILE = 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE'

/** Ricarica della pagina (sostituibile nei test). */
export const RICARICA_PAGINA = new InjectionToken<() => void>('RICARICA_PAGINA', {
  providedIn: 'root',
  factory: () => () => window.location.reload(),
})

/**
 * Tenant Interceptor
 *
 * Quando l'utente ha selezionato una società tramite il tenant switcher
 * (`AdminTenantContextService.set()`), aggiunge l'header `X-Tenant-ID: <id>`
 * a tutte le richieste dirette verso il backend (`environment.apiUrl`).
 *
 * Funziona per QUALUNQUE utente con accesso a più società (SUPER_ADMIN,
 * consulenti, owner multi-azienda). Il backend (`TenantSwitchInterceptor`)
 * è il punto autorevole di validazione: verifica la membership prima di
 * applicare il cambio di contesto.
 *
 * Se l'azienda selezionata non è più accessibile (per esempio un'associazione da
 * consulente scaduta), il backend risponde 403 `AZIENDA_SELEZIONATA_NON_ACCESSIBILE`
 * invece di lavorare in silenzio sull'azienda primaria: qui si cancella la selezione
 * memorizzata e si ricarica la pagina, che riparte senza header (azienda primaria).
 *
 * Deve essere registrato DOPO l'auth interceptor in `app.config.ts`.
 */
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const tenantContext = inject(AdminTenantContextService)
  const ricaricaPagina = inject(RICARICA_PAGINA)
  const tenantId = tenantContext.selectedTenantId()

  // Nessun tenant selezionato (utente standard o super admin in contesto globale).
  if (!tenantId) {
    return next(req)
  }

  // Aggiungi l'header solo alle richieste verso il backend dell'applicazione.
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req)
  }

  const tenantRequest = req.clone({
    setHeaders: {
      'X-Tenant-ID': tenantId,
    },
  })

  return next(tenantRequest).pipe(
    catchError((errore: unknown) =>
      codiceErrore(errore).pipe(
        mergeMap(codice => {
          if (
            errore instanceof HttpErrorResponse &&
            errore.status === 403 &&
            codice === AZIENDA_SELEZIONATA_NON_ACCESSIBILE &&
            // Sul refresh del token decide l'authInterceptor (logout e login, senza ricarica).
            !req.url.includes('/auth/') &&
            // Solo la prima delle richieste respinte insieme: le altre trovano la selezione
            // già cancellata e non ricaricano di nuovo.
            tenantContext.selectedTenantId() === tenantId
          ) {
            tenantContext.clear()
            ricaricaPagina()
          }
          return throwError(() => errore)
        })
      )
    )
  )
}

/**
 * Codice `error` del corpo di un errore HTTP. Con `responseType: 'blob'` (download) il corpo è
 * un Blob e va letto: senza, il 403 di un download non attivava il ripristino. Il Blob non si
 * consuma leggendolo, quindi il chiamante riceve l'errore originale ancora leggibile.
 */
function codiceErrore(errore: unknown): Observable<unknown> {
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
