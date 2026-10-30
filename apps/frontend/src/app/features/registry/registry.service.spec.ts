import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { RegistryService } from './registry.service'
import { environment } from '../../../environments/environment'

describe('RegistryService — ditte e sedi', () => {
  let service: RegistryService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/registry`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(RegistryService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('cercaDitta usa POST con il valore nel corpo, mai in query string (finirebbe nei log)', () => {
    service.cercaDitta('12345678903').subscribe()
    const req = http.expectOne(`${base}/ditte/cerca`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ identificativo: '12345678903' })
    expect(req.request.url).not.toContain('12345678903')
    expect(req.request.params.keys().length).toBe(0)
    req.flush({ ditta: null })
  })

  it('getDitta, aggiornaDitta', () => {
    service.getDitta('d1').subscribe()
    expect(http.expectOne(`${base}/ditte/d1`).request.method).toBe('GET')
    service.aggiornaDitta('d1', { partitaIva: '12345678903' }).subscribe()
    const put = http.expectOne(`${base}/ditte/d1`)
    expect(put.request.method).toBe('PUT')
    expect(put.request.body).toEqual({ partitaIva: '12345678903' })
  })

  it('sedi: creazione, aggiornamento, principale', () => {
    service
      .creaSede('d1', { via: 'V', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' })
      .subscribe()
    expect(http.expectOne(`${base}/ditte/d1/sedi`).request.method).toBe('POST')
    service.aggiornaSede('d1', 's1', { attiva: false }).subscribe()
    const put = http.expectOne(`${base}/ditte/d1/sedi/s1`)
    expect(put.request.method).toBe('PUT')
    expect(put.request.body).toEqual({ attiva: false })
    service.impostaSedePrincipale('d1', 's1').subscribe()
    expect(http.expectOne(`${base}/ditte/d1/sedi/s1/principale`).request.method).toBe('POST')
  })
})
