import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { SessioneService } from './sessione.service';

const conBearer = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/**
 * Aggiunge il Bearer alle chiamate `/api/`. Su 401 rinnova il token e ritenta UNA volta; se il
 * rinnovo o il ritento falliscono con 401 la sessione e' finita (scaduta o superata da un altro
 * accesso: sessione unica) e si torna al login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || req.url.includes('/auth/refresh')) return next(req);

  const sessione = inject(SessioneService);
  const router = inject(Router);
  const fineSessione = (e: unknown) => {
    sessione.pulisci();
    void router.navigate(['/login']);
    return throwError(() => e);
  };

  return next(conBearer(req, sessione.accessToken())).pipe(
    catchError((e: unknown) => {
      if (!(e instanceof HttpErrorResponse) || e.status !== 401) return throwError(() => e);
      return sessione.rinnova().pipe(
        catchError((er: unknown) =>
          er instanceof HttpErrorResponse && (er.status === 401 || er.status === 403)
            ? fineSessione(er)
            : throwError(() => er),
        ),
        switchMap((nuovo) =>
          next(conBearer(req, nuovo)).pipe(
            catchError((e2: unknown) =>
              e2 instanceof HttpErrorResponse && e2.status === 401
                ? fineSessione(e2)
                : throwError(() => e2),
            ),
          ),
        ),
      );
    }),
  );
};
