import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Auth Guard
 *
 * Protects routes that require authentication.
 * Redirects to login page if user is not authenticated.
 *
 * Usage in routes:
 * {
 *   path: 'dashboard',
 *   component: DashboardComponent,
 *   canActivate: [authGuard]
 * }
 */
export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): boolean | UrlTree => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Token presente e NON scaduto → accesso consentito.
  if (authService.isTokenValid()) {
    return true;
  }

  // Sessione assente o scaduta: pulizia + redirect alla login con returnUrl.
  authService.clearSession();
  const returnUrl = state.url;
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl },
  });
};

/**
 * Legacy class-based guard (kept for backward compatibility)
 * Note: This is exported for legacy code but should not be used in new code
 * @deprecated Use authGuard functional guard instead
 */
export const AuthGuard = authGuard;

/**
 * SPID Level Guard (Legacy class-based)
 *
 * Protects routes that require specific SPID authentication level.
 * Used for signature operations that require Level 2+.
 * @deprecated Use functional guard pattern instead
 */
export class SpidLevelGuard {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean | UrlTree> {
    return new Promise((resolve) => {
      this.authService.getSpidStatus().subscribe({
        next: (status) => {
          if (status.canSignDocuments) {
            resolve(true);
          } else {
            // Redirect to re-authentication or upgrade page
            resolve(
              this.router.createUrlTree(['/auth/spid-required'], {
                queryParams: {
                  returnUrl: state.url,
                  reason: status.reason,
                },
              })
            );
          }
        },
        error: () => {
          resolve(this.router.createUrlTree(['/login']));
        },
      });
    });
  }
}
