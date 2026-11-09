import { inject } from '@angular/core'
import { CanActivateFn, Router, UrlTree } from '@angular/router'
import { Observable, map } from 'rxjs'
import { AuthService } from '../services/auth.service'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'
import { FeatureFlagsService } from '../services/feature-flags.service'
import { ToastService } from '../services/toast.service'
import { MESSAGGIO_MODULO_NON_ATTIVO } from '../moduli/modulo-non-attivo'

/**
 * Guard di rotta per i moduli commerciali. La rotta dichiara `data: { modulo: 'fir' }` (una
 * chiave, oppure un elenco: basta uno dei moduli).
 *
 * - SUPER_ADMIN senza azienda selezionata: passa, senza chiedere nulla (D2b).
 * - SUPER_ADMIN con un'azienda selezionata: vale come per tutti i moduli di quell'azienda (D2b):
 *   `/me/features` col suo header `X-Tenant-ID` restituisce quelli dell'azienda scelta.
 * - Gli altri: aspetta `FeatureFlagsService.load()`, che risponde dalla cache (nessuna richiesta
 *   HTTP a ogni navigazione) o condivide il caricamento in corso del layout.
 * - Modulo non attivo (deep link a mano, per esempio `/fatturazione`): toast in italiano e
 *   redirect a `/dashboard`.
 * - Se `/me/features` non risponde non si blocca la navigazione: l'autorità è il backend, che
 *   risponde 403 `MODULO_NON_ATTIVO` (gestito da `moduloNonAttivoInterceptor`).
 *
 * Non sostituisce il controllo del backend: evita solo di mostrare una pagina che darebbe 403.
 */
export const moduloGuard: CanActivateFn = (
  route
): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const richiesti = moduliRichiesti(route.data?.['modulo'])
  if (richiesti.length === 0) return true

  const auth = inject(AuthService)
  const tenant = inject(AdminTenantContextService)
  if (auth.currentUser()?.role === 'SUPER_ADMIN' && !tenant.hasSelection()) {
    return true
  }

  const ff = inject(FeatureFlagsService)
  const router = inject(Router)
  const toast = inject(ToastService)

  return ff.load().pipe(
    map(() => {
      if (!ff.loaded()) return true
      if (richiesti.some(chiave => ff.has(chiave))) return true
      toast.warn(MESSAGGIO_MODULO_NON_ATTIVO)
      return router.createUrlTree(['/dashboard'])
    })
  )
}

function moduliRichiesti(dato: unknown): string[] {
  if (typeof dato === 'string') return [dato]
  if (Array.isArray(dato)) return dato.filter((x): x is string => typeof x === 'string')
  return []
}
