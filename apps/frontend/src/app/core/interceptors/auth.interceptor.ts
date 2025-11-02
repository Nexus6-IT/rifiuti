import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Auth Interceptor
 *
 * Automatically attaches JWT access token to all outgoing HTTP requests.
 * Handles 401 Unauthorized responses by redirecting to login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  const publicEndpoints = ['/auth/login', '/auth/register', '/health'];
  const isPublicEndpoint = publicEndpoints.some(endpoint => req.url.includes(endpoint));

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
        console.error('Authentication failed - redirecting to login');
        localStorage.removeItem('accessToken');
        router.navigate(['/auth/login']);
      }

      return throwError(() => error);
    })
  );
};
