import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { OrrService } from './orr.service'

describe('OrrService', () => {
  let service: OrrService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(OrrService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('anteprima: sede e mesi interi come da e a', () => {
    service.anteprima('ul-1', 2026, 1, 3).subscribe()
    const r = http.expectOne(x => x.url.endsWith('/comunicazioni/orr/anteprima'))
    expect(r.request.method).toBe('GET')
    expect(r.request.params.get('unitaLocaleId')).toBe('ul-1')
    expect(r.request.params.get('da')).toBe('2026-01-01')
    expect(r.request.params.get('a')).toBe('2026-03-31')
    r.flush({})
  })

  it('genera: POST con il periodo; l attivita solo se indicata', () => {
    service.genera('ul-1', 2026, 5, 5).subscribe()
    const r = http.expectOne(x => x.url.endsWith('/comunicazioni/orr'))
    expect(r.request.method).toBe('POST')
    expect(r.request.body).toEqual({ unitaLocaleId: 'ul-1', da: '2026-05-01', a: '2026-05-31' })
    r.flush({ file: [] })
    service.genera('ul-1', 2026, 5, 5, 'STO').subscribe()
    const r2 = http.expectOne(x => x.url.endsWith('/comunicazioni/orr'))
    expect(r2.request.body.attivita).toBe('STO')
    r2.flush({ file: [] })
  })

  it('storico: filtra per anno sul lato client', () => {
    let out: string[] = []
    service.storico('ul-1', 2026).subscribe(v => (out = v.map(x => x.id)))
    const r = http.expectOne(x => x.url.endsWith('/comunicazioni/orr'))
    expect(r.request.params.get('unitaLocaleId')).toBe('ul-1')
    r.flush([
      { id: 'a', periodoDa: '2026-05-01' },
      { id: 'b', periodoDa: '2025-05-01' },
    ])
    expect(out).toEqual(['a'])
  })
})
