import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * Auth Interceptor
 *
 * Allega il JWT alle richieste e, su 401 (sessione scaduta/non valida),
 * pulisce la sessione e riporta alla pagina di login conservando l'URL di
 * ritorno. Evita loop quando si è già sulla login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const publicEndpoints = ['/auth/spid', '/auth/callback', '/auth/refresh', '/health'];
  const isPublicEndpoint = publicEndpoints.some((endpoint) => req.url.includes(endpoint));

  if (isPublicEndpoint) {
    return next(req);
  }

  const accessToken = localStorage.getItem('accessToken');

  let authRequest = req;
  if (accessToken) {
    authRequest = req.clone({
      setHeaders: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  return next(authRequest).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        authService.clearSession();
        // Evita redirect ripetuti se siamo già sulla login.
        if (!router.url.startsWith('/login')) {
          const returnUrl = router.url && router.url !== '/' ? router.url : undefined;
          router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : {});
        }
      }
      return throwError(() => error);
    })
  );
};
