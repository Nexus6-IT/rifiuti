import { TestBed } from '@angular/core/testing'
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Router } from '@angular/router'
import { MessageService } from 'primeng/api'
import { Subject, of } from 'rxjs'
import { moduloNonAttivoInterceptor } from './modulo-non-attivo.interceptor'
import { RICARICA_PAGINA } from './tenant.interceptor'
import { FeatureFlagsService } from '../services/feature-flags.service'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'
import { MESSAGGIO_MODULO_NON_ATTIVO } from '../moduli/modulo-non-attivo'
import { environment } from '../../../environments/environment'

describe('moduloNonAttivoInterceptor', () => {
  let http: HttpClient
  let backend: HttpTestingController
  let ricarica: jasmine.Spy
  let ricaricaModuli: jasmine.Spy
  let navigaA: jasmine.Spy
  let aggiunti: { severity?: string; detail?: string }[]
  let contesto: AdminTenantContextService
  /** Moduli attivi dopo la ricarica e `data.modulo` della rotta corrente (null = rotta base). */
  let moduliAttivi: string[]
  let moduloRotta: string | null

  const url = `${environment.apiUrl}/fatturazione/elaborazioni`
  const rifiuto = {
    statusCode: 403,
    error: 'MODULO_NON_ATTIVO',
    message: "Il modulo non è attivo per l'azienda selezionata.",
    details: { moduli: ['contratti'] },
  }

  beforeEach(() => {
    localStorage.removeItem('wf_admin_tenant')
    ricarica = jasmine.createSpy('ricarica')
    ricaricaModuli = jasmine.createSpy('ricarica moduli').and.returnValue(of({ features: ['fir'] }))
    moduliAttivi = ['fir']
    moduloRotta = 'contratti'
    navigaA = jasmine.createSpy('navigateByUrl').and.resolveTo(true)
    aggiunti = []
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([moduloNonAttivoInterceptor])),
        provideHttpClientTesting(),
        { provide: RICARICA_PAGINA, useValue: ricarica },
        {
          provide: FeatureFlagsService,
          useValue: {
            ricarica: ricaricaModuli,
            loaded: () => true,
            has: (k: string) => moduliAttivi.includes(k),
          },
        },
        {
          provide: Router,
          useValue: {
            navigateByUrl: navigaA,
            routerState: {
              snapshot: {
                get root() {
                  return {
                    data: {},
                    firstChild: {
                      data: moduloRotta ? { modulo: moduloRotta } : {},
                      firstChild: null,
                    },
                  }
                },
              },
            },
          },
        },
        { provide: MessageService, useValue: { add: (m: never) => aggiunti.push(m) } },
      ],
    })
    http = TestBed.inject(HttpClient)
    backend = TestBed.inject(HttpTestingController)
    contesto = TestBed.inject(AdminTenantContextService)
  })

  afterEach(() => {
    backend.verify()
    localStorage.removeItem('wf_admin_tenant')
  })

  it('su 403 MODULO_NON_ATTIVO con la rotta corrente di quel modulo: ricarica, toast e /dashboard', () => {
    let errore: unknown
    http.get(url).subscribe({ error: e => (errore = e) })
    backend.expectOne(url).flush(rifiuto, { status: 403, statusText: 'Forbidden' })

    expect(ricaricaModuli).toHaveBeenCalledTimes(1)
    expect(aggiunti.length).toBe(1)
    expect(aggiunti[0].severity).toBe('warn')
    expect(aggiunti[0].detail).toBe(MESSAGGIO_MODULO_NON_ATTIVO)
    expect(navigaA).toHaveBeenCalledWith('/dashboard')
    expect(errore).toBeTruthy()
  })

  it('chiamata secondaria di una pagina lecita (modulo attivo): ricarica ma non espelle, nessun toast', () => {
    moduloRotta = 'fir'
    let errore: unknown
    http.get(`${environment.apiUrl}/rentri/sync/logs`).subscribe({ error: e => (errore = e) })
    backend
      .expectOne(`${environment.apiUrl}/rentri/sync/logs`)
      .flush(rifiuto, { status: 403, statusText: 'Forbidden' })
    expect(ricaricaModuli).toHaveBeenCalledTimes(1)
    expect(navigaA).not.toHaveBeenCalled()
    expect(aggiunti.length).toBe(0)
    expect(errore).toBeTruthy()
  })

  it('chiamata secondaria da una rotta base (senza data.modulo): nessun redirect', () => {
    moduloRotta = null
    http.get(url).subscribe({ error: () => undefined })
    backend.expectOne(url).flush(rifiuto, { status: 403, statusText: 'Forbidden' })
    expect(navigaA).not.toHaveBeenCalled()
    expect(aggiunti.length).toBe(0)
  })

  it("NON azzera l'azienda selezionata e NON ricarica la pagina", () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    http.get(url).subscribe({ error: () => undefined })
    backend.expectOne(url).flush(rifiuto, { status: 403, statusText: 'Forbidden' })

    expect(contesto.selectedTenantId()).toBe('tenant-cliente')
    expect(ricarica).not.toHaveBeenCalled()
  })

  it('legge il codice anche da una risposta blob (download)', async () => {
    http.get(url, { responseType: 'blob' }).subscribe({ error: () => undefined })
    backend
      .expectOne(url)
      .flush(new Blob([JSON.stringify(rifiuto)]), { status: 403, statusText: 'Forbidden' })
    await new Promise(r => setTimeout(r, 20))
    expect(ricaricaModuli).toHaveBeenCalledTimes(1)
    expect(navigaA).toHaveBeenCalledWith('/dashboard')
  })

  it('403 con un altro codice non fa nulla', () => {
    http.get(url).subscribe({ error: () => undefined })
    backend.expectOne(url).flush({ error: 'ALTRO' }, { status: 403, statusText: 'Forbidden' })
    expect(ricaricaModuli).not.toHaveBeenCalled()
    expect(aggiunti.length).toBe(0)
    expect(navigaA).not.toHaveBeenCalled()
  })

  it('errori non 403 non fanno nulla', () => {
    http.get(url).subscribe({ error: () => undefined })
    backend.expectOne(url).flush(rifiuto, { status: 500, statusText: 'KO' })
    expect(ricaricaModuli).not.toHaveBeenCalled()
  })

  it('più richieste respinte insieme producono un solo toast e una sola ricarica', () => {
    const inCorso = new Subject<{ features: string[] }>()
    ricaricaModuli.and.returnValue(inCorso.asObservable())
    http.get(url).subscribe({ error: () => undefined })
    http.get(`${url}/2`).subscribe({ error: () => undefined })
    backend.expectOne(url).flush(rifiuto, { status: 403, statusText: 'Forbidden' })
    backend.expectOne(`${url}/2`).flush(rifiuto, { status: 403, statusText: 'Forbidden' })
    expect(ricaricaModuli).toHaveBeenCalledTimes(1)
    inCorso.next({ features: [] })
    inCorso.complete()
    expect(aggiunti.length).toBe(1)
  })
})
