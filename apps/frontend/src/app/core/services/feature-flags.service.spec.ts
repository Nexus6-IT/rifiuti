import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { FeatureFlagsService } from './feature-flags.service'
import { AdminTenantContextService } from './admin-tenant-context.service'
import { environment } from '../../../environments/environment'

describe('FeatureFlagsService: cache dei moduli', () => {
  const url = `${environment.apiUrl}/me/features`
  let ff: FeatureFlagsService
  let backend: HttpTestingController
  let contesto: AdminTenantContextService

  beforeEach(() => {
    localStorage.removeItem('wf_admin_tenant')
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    ff = TestBed.inject(FeatureFlagsService)
    backend = TestBed.inject(HttpTestingController)
    contesto = TestBed.inject(AdminTenantContextService)
  })

  afterEach(() => {
    backend.verify()
    localStorage.removeItem('wf_admin_tenant')
  })

  it('load() ripetuto fa una sola richiesta HTTP e poi risponde dalla cache', () => {
    ff.load().subscribe()
    backend.expectOne(url).flush({ features: ['fir'] })
    let letto: string[] = []
    ff.load().subscribe(r => (letto = r.features))
    backend.expectNone(url)
    expect(letto).toEqual(['fir'])
  })

  it('due load() mentre la richiesta è in volo condividono la stessa richiesta e la stessa risposta', () => {
    let a: string[] = []
    let b: string[] = []
    ff.load().subscribe(r => (a = r.features))
    ff.load().subscribe(r => (b = r.features))
    backend.expectOne(url).flush({ features: ['registro'] })
    expect(a).toEqual(['registro'])
    expect(b).toEqual(['registro'])
  })

  it("cambiando l'azienda selezionata ricalcola i moduli con una nuova richiesta", () => {
    ff.load().subscribe()
    backend.expectOne(url).flush({ features: ['fir', 'contratti'] })
    expect(ff.has('contratti')).toBeTrue()

    contesto.set('tenant-trial', 'Trial Srl')
    ff.load().subscribe()
    const req = backend.expectOne(url)
    expect(req.request.method).toBe('GET')
    req.flush({ features: ['fir'] })
    expect(ff.has('contratti')).toBeFalse()
    expect(ff.has('fir')).toBeTrue()
  })

  it('ricarica() rifà la richiesta anche se i moduli sono già in cache', () => {
    ff.load().subscribe()
    backend.expectOne(url).flush({ features: ['fir', 'esg'] })

    ff.ricarica().subscribe()
    backend.expectOne(url).flush({ features: ['fir'] })
    expect(ff.has('esg')).toBeFalse()
  })

  it('se la richiesta fallisce non segna i moduli come caricati e un nuovo load() riprova', () => {
    ff.load().subscribe()
    backend.expectOne(url).flush('errore', { status: 500, statusText: 'KO' })
    expect(ff.loaded()).toBeFalse()
    ff.load().subscribe()
    backend.expectOne(url).flush({ features: ['fir'] })
    expect(ff.loaded()).toBeTrue()
  })
})
