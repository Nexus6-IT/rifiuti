import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http'
import { inject } from '@angular/core'
import { throwError } from 'rxjs'
import { catchError } from 'rxjs/operators'
import { MessageService } from 'primeng/api'

/**
 * Error Interceptor
 *
 * Catches HTTP errors and displays user-friendly messages via PrimeNG toast.
 * Handles different error types with appropriate UI feedback.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const messageService = inject(MessageService)

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMessage = 'Si è verificato un errore imprevisto.'
      let severity: 'error' | 'warn' = 'error'

      if (error.error instanceof ErrorEvent) {
        errorMessage = `Errore del client: ${error.error.message}`
      } else {
        switch (error.status) {
          case 400:
            errorMessage = 'Richiesta non valida. Controlla i dati inseriti.'
            severity = 'warn'
            if (error.error?.message) {
              errorMessage = error.error.message
            }
            break
          case 401:
            errorMessage = 'Autenticazione richiesta. Accedi di nuovo.'
            break
          case 403:
            errorMessage = 'Non hai il permesso di eseguire questa azione.'
            break
          case 404:
            errorMessage = 'La risorsa richiesta non è stata trovata.'
            severity = 'warn'
            break
          case 409:
            errorMessage = 'Conflitto: la risorsa potrebbe essere stata modificata.'
            severity = 'warn'
            break
          case 422:
            errorMessage = 'Validazione non riuscita. Controlla i dati inseriti.'
            severity = 'warn'
            break
          case 429:
            errorMessage = 'Troppe richieste. Riprova più tardi.'
            severity = 'warn'
            break
          case 500:
            errorMessage = 'Errore del server. Riprova più tardi.'
            break
          case 503:
            errorMessage = 'Servizio temporaneamente non disponibile. Riprova più tardi.'
            break
          default:
            if (error.error?.message) {
              errorMessage = error.error.message
            }
        }
      }

      messageService.add({
        severity: severity,
        summary: severity === 'error' ? 'Errore' : 'Attenzione',
        detail: errorMessage,
        life: 5000,
      })

      return throwError(() => error)
    })
  )
}
