import { TestBed } from '@angular/core/testing'
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Router } from '@angular/router'
import { authInterceptor } from './auth.interceptor'
import { RICARICA_PAGINA, tenantInterceptor } from './tenant.interceptor'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'
import { environment } from '../../../environments/environment'

/**
 * Refresh del token rifiutato perché l'azienda scelta con lo switch non è più accessibile:
 * niente richiesta ripetuta, niente ricarica in loop, si torna al login senza selezione.
 */
describe('authInterceptor — refresh rifiutato per azienda non accessibile', () => {
  let http: HttpClient
  let backend: HttpTestingController
  let contesto: AdminTenantContextService
  let ricarica: jasmine.Spy
  let router: { url: string; navigate: jasmine.Spy }

  const urlRegistro = `${environment.apiUrl}/registro`
  const urlRefresh = `${environment.apiUrl}/auth/refresh`

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('accessToken', 'token-scaduto')
    localStorage.setItem('refreshToken', 'refresh-dello-switch')
    ricarica = jasmine.createSpy('ricarica')
    router = { url: '/registro', navigate: jasmine.createSpy('navigate') }
    TestBed.configureTestingModule({
      providers: [
        // stesso ordine di app.config.ts
        provideHttpClient(withInterceptors([authInterceptor, tenantInterceptor])),
        provideHttpClientTesting(),
        { provide: RICARICA_PAGINA, useValue: ricarica },
        { provide: Router, useValue: router },
      ],
    })
    http = TestBed.inject(HttpClient)
    backend = TestBed.inject(HttpTestingController)
    contesto = TestBed.inject(AdminTenantContextService)
  })

  afterEach(() => {
    backend.verify()
    localStorage.clear()
  })

  it('non ripete la richiesta, svuota sessione e selezione e torna al login', () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    let errore: unknown
    http.post(urlRegistro, {}).subscribe({ error: e => (errore = e) })

    backend.expectOne(urlRegistro).flush(null, { status: 401, statusText: 'Unauthorized' })
    backend.expectOne(urlRefresh).flush(
      {
        statusCode: 403,
        error: 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE',
        message: "L'azienda selezionata non è più accessibile: selezionane un'altra.",
      },
      { status: 403, statusText: 'Forbidden' }
    )

    // backend.verify(): nessun secondo POST /registro (la richiesta non viene ripetuta)
    expect(errore).toBeTruthy()
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
    expect(contesto.selectedTenantId()).toBeNull()
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/registro' },
    })
    // il login è la ripartenza: nessuna ricarica che si sovrapponga alla navigazione
    expect(ricarica).not.toHaveBeenCalled()
  })

  it('refresh con verifica non disponibile (503): sessione e selezione restano, si riprova', () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    let errore: any
    http.post(urlRegistro, {}).subscribe({ error: e => (errore = e) })

    backend.expectOne(urlRegistro).flush(null, { status: 401, statusText: 'Unauthorized' })
    backend.expectOne(urlRefresh).flush(
      {
        statusCode: 503,
        error: 'VERIFICA_AZIENDA_NON_DISPONIBILE',
        message: "Verifica dell'azienda selezionata non disponibile, riprova.",
      },
      { status: 503, statusText: 'Service Unavailable' }
    )

    expect(errore?.status).toBe(503)
    expect(localStorage.getItem('refreshToken')).toBe('refresh-dello-switch')
    expect(contesto.selectedTenantId()).toBe('tenant-cliente')
    expect(router.navigate).not.toHaveBeenCalled()
  })
})

describe('authInterceptor — endpoint pubblico /verify', () => {
  let http: HttpClient
  let backend: HttpTestingController

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('accessToken', 'token')
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { url: '/', navigate: jasmine.createSpy('navigate') } },
      ],
    })
    http = TestBed.inject(HttpClient)
    backend = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    backend.verify()
    localStorage.clear()
  })

  it('GET /fir/:id/verify va senza Authorization', () => {
    http.get(`${environment.apiUrl}/fir/abc/verify`).subscribe()
    expect(
      backend.expectOne(r => r.url.endsWith('/fir/abc/verify')).request.headers.has('Authorization')
    ).toBeFalse()
  })

  it('GET /fir/:id/verify-url resta autenticato', () => {
    http.get(`${environment.apiUrl}/fir/abc/verify-url`).subscribe()
    expect(
      backend.expectOne(r => r.url.endsWith('/verify-url')).request.headers.get('Authorization')
    ).toBe('Bearer token')
  })
})
