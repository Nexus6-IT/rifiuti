import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { TracciatiService } from './tracciati.service'

describe('TracciatiService', () => {
  let service: TracciatiService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(TracciatiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('anteprima CONOU: GET /comunicazioni/conou/anteprima con sede e periodo', () => {
    service.anteprima('CONOU', 'ul-1', '2026-05-01', '2026-05-31').subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/conou/anteprima'))
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('unitaLocaleId')).toBe('ul-1')
    expect(req.request.params.get('da')).toBe('2026-05-01')
    expect(req.request.params.get('a')).toBe('2026-05-31')
    req.flush({})
  })

  it('anteprima COBAT: GET /comunicazioni/cobat/anteprima', () => {
    service.anteprima('COBAT', 'ul-1', '2026-05-01', '2026-05-31').subscribe()
    http.expectOne(r => r.url.endsWith('/comunicazioni/cobat/anteprima')).flush({})
  })

  it('genera: POST /comunicazioni/cobat con sede e periodo', () => {
    service.genera('COBAT', 'ul-1', '2026-05-01', '2026-05-31').subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/cobat'))
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ unitaLocaleId: 'ul-1', da: '2026-05-01', a: '2026-05-31' })
    req.flush({})
  })

  it('storico: GET /comunicazioni/tracciati con consorzio, sede e periodo', () => {
    service.storico('CONOU', 'ul-1', '2026-05-01', '2026-05-31').subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/tracciati'))
    expect(req.request.params.get('consorzio')).toBe('CONOU')
    expect(req.request.params.get('unitaLocaleId')).toBe('ul-1')
    expect(req.request.params.get('da')).toBe('2026-05-01')
    expect(req.request.params.get('a')).toBe('2026-05-31')
    req.flush([])
  })
})
