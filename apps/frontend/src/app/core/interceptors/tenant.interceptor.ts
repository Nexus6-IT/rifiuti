import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { InjectionToken, inject } from '@angular/core'
import { catchError, throwError } from 'rxjs'
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
    catchError((errore: unknown) => {
      if (
        errore instanceof HttpErrorResponse &&
        errore.status === 403 &&
        errore.error?.error === AZIENDA_SELEZIONATA_NON_ACCESSIBILE &&
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
}
