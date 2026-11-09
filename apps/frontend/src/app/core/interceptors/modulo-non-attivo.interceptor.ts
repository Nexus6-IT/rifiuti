import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { inject } from '@angular/core'
import { Router } from '@angular/router'
import { catchError, finalize, mergeMap, throwError } from 'rxjs'
import { ToastService } from '../services/toast.service'
import { FeatureFlagsService } from '../services/feature-flags.service'
import { MESSAGGIO_MODULO_NON_ATTIVO, MODULO_NON_ATTIVO } from '../moduli/modulo-non-attivo'
import { environment } from '../../../environments/environment'
import { codiceErrore } from './codice-errore'

/** Gestione già in corso: più richieste respinte insieme producono un solo toast. */
let gestioneInCorso = false

/**
 * Reazione al 403 `MODULO_NON_ATTIVO` del backend (modulo non attivo per l'azienda selezionata):
 * ricarica i moduli (il menu si aggiorna), mostra un toast in italiano e porta l'utente su
 * `/dashboard`. A differenza di `AZIENDA_SELEZIONATA_NON_ACCESSIBILE` NON azzera l'azienda
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
            toast.warn(MESSAGGIO_MODULO_NON_ATTIVO)
            void router.navigateByUrl('/dashboard')
            ff.ricarica()
              .pipe(finalize(() => (gestioneInCorso = false)))
              .subscribe()
          }
          return throwError(() => errore)
        })
      )
    )
  )
}
