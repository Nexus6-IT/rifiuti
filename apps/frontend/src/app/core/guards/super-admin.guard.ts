import { inject } from '@angular/core'
import { Router, CanActivateFn, UrlTree } from '@angular/router'
import { AuthService } from '../services/auth.service'

/**
 * Guard di rotta per le sole funzioni riservate al super amministratore.
 *
 * Perche' esiste: fino al 2026-07-26 il progetto non aveva alcun guard di
 * ruolo sulle rotte — l'unico era `authGuard` — quindi il gating dei menu era
 * puramente cosmetico e qualunque utente autenticato poteva raggiungere una
 * pagina riservata digitandone l'URL.
 *
 * Non sostituisce l'autorizzazione lato server, che resta l'unica reale: qui
 * si evita solo di mostrare una pagina che l'utente non puo' usare. Ogni
 * endpoint corrispondente deve comunque avere il proprio `@Roles`.
 */
export const superAdminGuard: CanActivateFn = (): boolean | UrlTree => {
  const authService = inject(AuthService)
  const router = inject(Router)

  if (authService.currentUser()?.role === 'SUPER_ADMIN') {
    return true
  }

  // Rimanda alla dashboard invece di mostrare un errore: per l'utente quella
  // pagina semplicemente non esiste.
  return router.createUrlTree(['/dashboard'])
}
