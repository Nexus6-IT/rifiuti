import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router'
import { Observable, firstValueFrom, isObservable } from 'rxjs'
import { MessageService } from 'primeng/api'
import { AuthService } from '../services/auth.service'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'
import { MESSAGGIO_MODULO_NON_ATTIVO } from '../moduli/modulo-non-attivo'
import { moduloGuard } from './modulo.guard'
import { environment } from '../../../environments/environment'

describe('moduloGuard', () => {
  const url = `${environment.apiUrl}/me/features`
  const utente = signal<{ role: string } | null>({ role: 'ADMIN' })
  let backend: HttpTestingController
  let router: Router
  let contesto: AdminTenantContextService
  let aggiunti: unknown[]

  const rotta = (modulo: string | string[]) =>
    ({ data: { modulo } }) as unknown as ActivatedRouteSnapshot

  const esegui = (modulo: string | string[], percorso = '/fatturazione') =>
    TestBed.runInInjectionContext(
      () =>
        moduloGuard(rotta(modulo), { url: percorso } as RouterStateSnapshot) as
          | boolean
          | UrlTree
          | Observable<boolean | UrlTree>
    )

  const risolvi = async (modulo: string | string[], rispostaFeatures?: string[]) => {
    const esito = esegui(modulo)
    if (!isObservable(esito)) return esito
    const promessa = firstValueFrom(esito)
    if (rispostaFeatures) backend.expectOne(url).flush({ features: rispostaFeatures })
    return promessa
  }

  beforeEach(() => {
    localStorage.removeItem('wf_admin_tenant')
    utente.set({ role: 'ADMIN' })
    aggiunti = []
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentUser: utente } },
        { provide: MessageService, useValue: { add: (m: unknown) => aggiunti.push(m) } },
      ],
    })
    backend = TestBed.inject(HttpTestingController)
    router = TestBed.inject(Router)
    contesto = TestBed.inject(AdminTenantContextService)
  })

  afterEach(() => {
    backend.verify()
    localStorage.removeItem('wf_admin_tenant')
  })

  it('lascia passare se il modulo è attivo', async () => {
    expect(await risolvi('contratti', ['fir', 'contratti'])).toBeTrue()
    expect(aggiunti.length).toBe(0)
  })

  it('con data.modulo a più chiavi passa se ne basta una attiva', async () => {
    expect(await risolvi(['esg', 'mud'], ['mud'])).toBeTrue()
  })

  it('deep link a un modulo non attivo: porta su /dashboard con il toast in italiano', async () => {
    const esito = await risolvi('contratti', ['fir'])
    expect(esito instanceof UrlTree).toBeTrue()
    expect(router.serializeUrl(esito as UrlTree)).toBe('/dashboard')
    expect(aggiunti.length).toBe(1)
    expect(JSON.stringify(aggiunti[0])).toContain(MESSAGGIO_MODULO_NON_ATTIVO)
  })

  it('non fa una richiesta HTTP a ogni navigazione: usa la cache dopo il primo caricamento', async () => {
    await risolvi('fir', ['fir', 'contratti'])
    const seconda = esegui('contratti')
    expect(isObservable(seconda)).toBeTrue()
    expect(await firstValueFrom(seconda as Observable<boolean | UrlTree>)).toBeTrue()
    backend.expectNone(url)
  })

  it('aspetta il caricamento in corso invece di decidere sui moduli ancora vuoti', async () => {
    const primo = esegui('fir') as Observable<boolean | UrlTree>
    const secondo = esegui('contratti') as Observable<boolean | UrlTree>
    const p1 = firstValueFrom(primo)
    const p2 = firstValueFrom(secondo)
    backend.expectOne(url).flush({ features: ['fir', 'contratti'] })
    expect(await p1).toBeTrue()
    expect(await p2).toBeTrue()
  })

  it('SUPER_ADMIN senza azienda selezionata passa senza chiedere i moduli', () => {
    utente.set({ role: 'SUPER_ADMIN' })
    expect(esegui('fatturazione')).toBeTrue()
    backend.expectNone(url)
  })

  it("D2b: SUPER_ADMIN con un'azienda selezionata vale con i moduli di quell'azienda", async () => {
    utente.set({ role: 'SUPER_ADMIN' })
    contesto.set('tenant-trial', 'Trial Srl')
    const esito = await risolvi('contratti', ['fir'])
    expect(esito instanceof UrlTree).toBeTrue()
    expect(aggiunti.length).toBe(1)
  })

  it("D2b: SUPER_ADMIN con un'azienda selezionata passa se l'azienda ha il modulo", async () => {
    utente.set({ role: 'SUPER_ADMIN' })
    contesto.set('tenant-pro', 'Pro Srl')
    expect(await risolvi('contratti', ['contratti'])).toBeTrue()
  })

  it('se /me/features non risponde non blocca la navigazione (decide il backend con il 403)', async () => {
    const esito = esegui('contratti') as Observable<boolean | UrlTree>
    const promessa = firstValueFrom(esito)
    backend.expectOne(url).flush('errore', { status: 500, statusText: 'KO' })
    expect(await promessa).toBeTrue()
    expect(aggiunti.length).toBe(0)
  })
})
