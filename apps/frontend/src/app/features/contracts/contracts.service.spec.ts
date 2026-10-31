import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { ContractsService } from './contracts.service'
import { environment } from '../../../environments/environment'

describe('ContractsService', () => {
  let service: ContractsService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/contracts`

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    service = TestBed.inject(ContractsService)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('update fa PATCH su /contracts/:id col corpo', () => {
    let risposta: unknown
    service
      .update('c1', { basePrice: 130, endDate: null, versione: 4 })
      .subscribe(r => (risposta = r))
    const req = http.expectOne(`${base}/c1`)
    expect(req.request.method).toBe('PATCH')
    expect(req.request.body).toEqual({ basePrice: 130, endDate: null, versione: 4 })
    req.flush({ id: 'c1' })
    expect(risposta).toEqual({ id: 'c1' })
  })

  it('elimina fa DELETE con ?versione=3', () => {
    service.elimina('c1', 3).subscribe()
    const req = http.expectOne(r => r.url === `${base}/c1`)
    expect(req.request.method).toBe('DELETE')
    expect(req.request.params.get('versione')).toBe('3')
    req.flush(null)
  })
})
