import { TestBed } from '@angular/core/testing'
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { RICARICA_PAGINA, tenantInterceptor } from './tenant.interceptor'
import { AdminTenantContextService } from '../services/admin-tenant-context.service'
import { environment } from '../../../environments/environment'

describe('tenantInterceptor', () => {
  let http: HttpClient
  let backend: HttpTestingController
  let contesto: AdminTenantContextService
  let ricarica: jasmine.Spy

  const url = `${environment.apiUrl}/registro`
  const rifiuto = {
    statusCode: 403,
    error: 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE',
    message: "L'azienda selezionata non è più accessibile: selezionane un'altra.",
  }

  beforeEach(() => {
    localStorage.removeItem('wf_admin_tenant')
    ricarica = jasmine.createSpy('ricarica')
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tenantInterceptor])),
        provideHttpClientTesting(),
        { provide: RICARICA_PAGINA, useValue: ricarica },
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

  it("aggiunge X-Tenant-ID con un'azienda selezionata", () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    http.get(url).subscribe()
    const req = backend.expectOne(url)
    expect(req.request.headers.get('X-Tenant-ID')).toBe('tenant-cliente')
    req.flush([])
  })

  it('su AZIENDA_SELEZIONATA_NON_ACCESSIBILE cancella la selezione e ricarica la pagina', () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    let errore: unknown
    http.get(url).subscribe({ error: e => (errore = e) })

    backend.expectOne(url).flush(rifiuto, { status: 403, statusText: 'Forbidden' })

    expect(contesto.selectedTenantId()).toBeNull()
    expect(localStorage.getItem('wf_admin_tenant')).toBeNull()
    expect(ricarica).toHaveBeenCalledTimes(1)
    expect(errore).toBeTruthy() // l'errore prosegue verso il chiamante
  })

  it('più richieste respinte insieme ricaricano una volta sola', () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    http.get(url).subscribe({ error: () => undefined })
    http.get(url).subscribe({ error: () => undefined })

    for (const req of backend.match(url)) {
      req.flush(rifiuto, { status: 403, statusText: 'Forbidden' })
    }

    expect(ricarica).toHaveBeenCalledTimes(1)
  })

  it('un altro 403 (ruolo insufficiente) non tocca la selezione', () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    http.get(url).subscribe({ error: () => undefined })

    backend
      .expectOne(url)
      .flush(
        { statusCode: 403, error: 'REGISTRO_RISERVATO_OPERATORI', message: 'Solo…' },
        { status: 403, statusText: 'Forbidden' }
      )

    expect(contesto.selectedTenantId()).toBe('tenant-cliente')
    expect(ricarica).not.toHaveBeenCalled()
  })

  it('503 VERIFICA_AZIENDA_NON_DISPONIBILE (errore del database): selezione conservata, nessuna ricarica', () => {
    contesto.set('tenant-cliente', 'Cliente Srl')
    let errore: unknown
    http.get(url).subscribe({ error: e => (errore = e) })

    backend.expectOne(url).flush(
      {
        statusCode: 503,
        error: 'VERIFICA_AZIENDA_NON_DISPONIBILE',
        message: "Verifica dell'azienda selezionata non disponibile, riprova.",
      },
      { status: 503, statusText: 'Service Unavailable' }
    )

    expect(errore).toBeTruthy()
    expect(contesto.selectedTenantId()).toBe('tenant-cliente')
    expect(ricarica).not.toHaveBeenCalled()
  })
})
