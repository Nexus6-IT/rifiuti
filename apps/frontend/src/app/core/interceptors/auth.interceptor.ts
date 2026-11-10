import { HttpInterceptorFn, HttpErrorResponse, HttpRequest } from '@angular/common/http'
import { inject } from '@angular/core'
import { Router } from '@angular/router'
import { throwError } from 'rxjs'
import { catchError, switchMap } from 'rxjs/operators'
import { AuthService } from '../services/auth.service'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'

/**
 * Auth Interceptor
 *
 * Allega il JWT alle richieste. Su 401 tenta UNA volta il refresh silenzioso
 * dell'access token (endpoint /auth/refresh) e ritenta la richiesta originale;
 * se il refresh fallisce (o manca il refresh token) pulisce la sessione e riporta
 * al login conservando l'URL di ritorno. Evita loop: gli endpoint pubblici e la
 * richiesta di refresh stessa non vengono intercettati per il retry.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router)
  const authService = inject(AuthService)
  const tenantContext = inject(AdminTenantContextService)

  const publicEndpoints = [
    '/auth/spid',
    '/auth/callback',
    '/auth/refresh',
    '/health',
    '/auth/access-request',
    // Verifica pubblica delle firme (QR del PDF): anonima, niente token ne' refresh.
    '/verify',
  ]
  const isPublicEndpoint = publicEndpoints.some(endpoint => req.url.includes(endpoint))

  if (isPublicEndpoint) {
    return next(req)
  }

  const withToken = (request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> =>
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request

  const accessToken = localStorage.getItem('accessToken')

  const redirectToLogin = (): void => {
    authService.clearSession()
    // Anche la selezione dell'azienda in memoria: un refresh rifiutato perché l'azienda scelta
    // non è più accessibile (403 AZIENDA_SELEZIONATA_NON_ACCESSIBILE) non deve ripartire da lì.
    tenantContext.clear()
    if (!router.url.startsWith('/login')) {
      const returnUrl = router.url && router.url !== '/' ? router.url : undefined
      router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : {})
    }
  }

  return next(withToken(req, accessToken)).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401) {
        return throwError(() => error)
      }

      // Nessun refresh token → non si può rinnovare: sessione terminata.
      if (!authService.getRefreshToken()) {
        redirectToLogin()
        return throwError(() => error)
      }

      // Tenta il refresh UNA volta e ritenta la richiesta originale col nuovo token.
      return authService.refreshAccessToken().pipe(
        switchMap(newToken => next(withToken(req, newToken))),
        catchError((erroreRefresh: unknown) => {
          // 503 VERIFICA_AZIENDA_NON_DISPONIBILE: il backend non ha potuto verificare l'azienda
          // (database). Il refresh token resta valido e la selezione pure: si riprova, niente
          // logout.
          if (erroreRefresh instanceof HttpErrorResponse && erroreRefresh.status === 503) {
            return throwError(() => erroreRefresh)
          }
          // Refresh fallito/revocato: logout pulito.
          redirectToLogin()
          return throwError(() => error)
        })
      )
    })
  )
}
