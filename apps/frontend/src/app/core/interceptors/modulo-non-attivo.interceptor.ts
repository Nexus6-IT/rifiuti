import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { inject } from '@angular/core'
import { ActivatedRouteSnapshot, Router } from '@angular/router'
import { catchError, finalize, mergeMap, throwError } from 'rxjs'
import { ToastService } from '../services/toast.service'
import { FeatureFlagsService } from '../services/feature-flags.service'
import { MESSAGGIO_MODULO_NON_ATTIVO, MODULO_NON_ATTIVO } from '../moduli/modulo-non-attivo'
import { environment } from '../../../environments/environment'
import { codiceErrore } from './codice-errore'

/**
 * True se la rotta attiva richiede (via `data.modulo`) un modulo che ora non è attivo.
 * Serve a distinguere il 403 della pagina corrente (si esce) da quello di una chiamata
 * secondaria (pannello, badge, dashboard) che non deve espellere l'utente da una pagina lecita.
 */
function rottaCorrenteNonAmmessa(router: Router, ff: FeatureFlagsService): boolean {
  if (!ff.loaded()) return false
  let nodo: ActivatedRouteSnapshot | null = router.routerState?.snapshot?.root ?? null
  while (nodo) {
    const dato: unknown = nodo.data?.['modulo']
    const richiesti =
      typeof dato === 'string' ? [dato] : Array.isArray(dato) ? (dato as string[]) : []
    if (richiesti.length > 0 && !richiesti.some(m => ff.has(m))) return true
    nodo = nodo.firstChild
  }
  return false
}

/** Gestione già in corso: più richieste respinte insieme producono un solo toast. */
let gestioneInCorso = false

/**
 * Reazione al 403 `MODULO_NON_ATTIVO` del backend (modulo non attivo per l'azienda selezionata):
 * ricarica i moduli (il menu si aggiorna) e, SE la rotta corrente richiede quel modulo, mostra un
 * toast in italiano e porta l'utente su `/dashboard`; se la pagina resta lecita non fa nulla. A differenza di `AZIENDA_SELEZIONATA_NON_ACCESSIBILE` NON azzera l'azienda
 * selezionata e non ricarica la pagina: l'azienda è valida, è solo un modulo a non essere attivo.
 * L'errore resta propagato al chiamante.
 *
 * Registrato dopo `tenantInterceptor` in `app.config.ts`.
 */
export const moduloNonAttivoInterceptor: HttpInterceptorFn = (req, next) => {
  const ff = inject(FeatureFlagsService)
  const router = inject(Router)
  const toast = inject(ToastService)

  return next(req).pipe(
    catchError((errore: unknown) =>
      codiceErrore(errore).pipe(
        mergeMap(codice => {
          if (
            errore instanceof HttpErrorResponse &&
            errore.status === 403 &&
            codice === MODULO_NON_ATTIVO &&
            req.url.startsWith(environment.apiUrl) &&
            !gestioneInCorso
          ) {
            gestioneInCorso = true
            // Prima si ricalcolano i moduli, poi si decide: si esce solo se la pagina in cui
            // si è richiede il modulo non attivo. Una chiamata secondaria non espelle nessuno.
            ff.ricarica()
              .pipe(finalize(() => (gestioneInCorso = false)))
              .subscribe(() => {
                if (rottaCorrenteNonAmmessa(router, ff)) {
                  toast.warn(MESSAGGIO_MODULO_NON_ATTIVO)
                  void router.navigateByUrl('/dashboard')
                }
              })
          }
          return throwError(() => errore)
        })
      )
    )
  )
}
