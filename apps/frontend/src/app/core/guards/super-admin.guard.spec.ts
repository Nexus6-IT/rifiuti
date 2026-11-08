import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router'
import { AuthService } from '../services/auth.service'
import { superAdminGuard } from './super-admin.guard'

/**
 * Task 15 (bug 19): chi non e' SUPER_ADMIN non finisce piu' in silenzio sulla Dashboard, ma sulla
 * pagina «Accesso non consentito» esistente. In Angular 17 uno `UrlTree` non porta stato di
 * navigazione: il contesto passa nei query param letti da `PermissionDeniedComponent`.
 */
describe('superAdminGuard', () => {
  const utente = signal<{ role: string } | null>(null)
  let router: Router

  const esegui = (url: string) =>
    TestBed.runInInjectionContext(() =>
      superAdminGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
    )

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { currentUser: utente } }],
    })
    router = TestBed.inject(Router)
  })

  it('lascia passare il SUPER_ADMIN', () => {
    utente.set({ role: 'SUPER_ADMIN' })
    expect(esegui('/abbonamento')).toBeTrue()
  })

  it("manda l'ADMIN su /permissions/denied con la pagina e il ruolo, non sulla Dashboard", () => {
    utente.set({ role: 'ADMIN' })
    const esito = esegui('/abbonamento')
    expect(esito instanceof UrlTree).toBeTrue()
    const url = router.serializeUrl(esito as UrlTree)
    expect(url).toContain('/permissions/denied?')
    expect(url).toContain('resource=')
    expect(url).toContain('role=ADMIN')
    expect(url).not.toContain('/dashboard')
  })

  it('indica la pagina negata col suo nome in italiano', () => {
    utente.set({ role: 'OPERATOR' })
    const nomi: Record<string, string> = {
      '/abbonamento': 'Abbonamento',
      '/admin/stato-sistema': 'Stato del sistema',
      '/reference-data': 'Dati di riferimento',
    }
    for (const [percorso, nome] of Object.entries(nomi)) {
      const url = router.serializeUrl(esegui(percorso) as UrlTree)
      expect(decodeURIComponent(url)).toContain(`resource=${nome}`)
    }
  })

  it('senza utente (sessione scaduta) tratta il ruolo come sconosciuto, senza eccezioni', () => {
    utente.set(null)
    const url = router.serializeUrl(esegui('/abbonamento') as UrlTree)
    expect(url).toContain('/permissions/denied?')
  })
})
