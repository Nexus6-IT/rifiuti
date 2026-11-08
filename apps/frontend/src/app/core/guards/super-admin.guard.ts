import { inject } from '@angular/core'
import { Router, CanActivateFn, UrlTree } from '@angular/router'
import { AuthService } from '../services/auth.service'

/** Nome in italiano delle pagine riservate, per il messaggio di «Accesso non consentito». */
const NOMI_PAGINE: Record<string, string> = {
  '/abbonamento': 'Abbonamento',
  '/admin/stato-sistema': 'Stato del sistema',
  '/reference-data': 'Dati di riferimento',
}

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
export const superAdminGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const authService = inject(AuthService)
  const router = inject(Router)

  const ruolo = authService.currentUser()?.role
  if (ruolo === 'SUPER_ADMIN') {
    return true
  }

  // Accesso negato esplicito (bug 19): prima l'utente finiva in silenzio sulla Dashboard e non
  // capiva perche' la pagina "non si apriva". Ora va su «Accesso non consentito». In Angular 17 lo
  // UrlTree non porta stato di navigazione (RedirectCommand arriva in Angular 18): il contesto
  // viaggia nei query param che `PermissionDeniedComponent` gia' legge (`resource`, `role`).
  const percorso = (state?.url ?? '').split(/[?#]/)[0]
  return router.createUrlTree(['/permissions/denied'], {
    queryParams: {
      resource: NOMI_PAGINE[percorso] ?? 'questa pagina',
      role: ruolo ?? 'Sconosciuto',
    },
  })
}
