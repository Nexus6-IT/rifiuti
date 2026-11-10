import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ConsorziService } from './consorzi.service'

describe('ConsorziService', () => {
  let service: ConsorziService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(ConsorziService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('regole: GET /comunicazioni/consorzi/regole', () => {
    service.regole().subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/regole'))
    expect(req.request.method).toBe('GET')
    req.flush({ regole: [], puoModificare: false })
  })

  it('crea, modifica ed elimina una regola', () => {
    const input = {
      consorzio: 'CONOU' as const,
      cer: '13',
      verso: null,
      causaleCodice: null,
      attiva: true,
    }
    service.creaRegola(input).subscribe()
    const crea = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/regole'))
    expect(crea.request.method).toBe('POST')
    expect(crea.request.body).toEqual(input)
    crea.flush({})
    service.modificaRegola('r1', input).subscribe()
    const mod = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/regole/r1'))
    expect(mod.request.method).toBe('PUT')
    mod.flush({})
    service.eliminaRegola('r1').subscribe()
    const del = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/regole/r1'))
    expect(del.request.method).toBe('DELETE')
    del.flush(null)
  })

  it('consorziDeiMovimenti: id separati da virgola', () => {
    service.consorziDeiMovimenti(['a', 'b']).subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/movimenti'))
    expect(req.request.params.get('ids')).toBe('a,b')
    req.flush({})
  })

  it('override: PUT con escluso e DELETE sul movimento e consorzio', () => {
    service.impostaOverride('m1', 'COBAT', true).subscribe()
    const put = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/movimenti/m1/COBAT'))
    expect(put.request.method).toBe('PUT')
    expect(put.request.body).toEqual({ escluso: true })
    put.flush({ marcature: [], esclusi: [] })
    service.rimuoviOverride('m1', 'COBAT').subscribe()
    const del = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/movimenti/m1/COBAT'))
    expect(del.request.method).toBe('DELETE')
    del.flush({ marcature: [], esclusi: [] })
  })

  it('scaricaEstratto: parametri e nome del file dall’intestazione', done => {
    service.scaricaEstratto('CONOU', '2026-01-01', '2026-03-31', 'ul-1').subscribe(f => {
      expect(f.nomeFile).toBe('estratto-conou.csv')
      done()
    })
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/estratto'))
    expect(req.request.params.get('consorzio')).toBe('CONOU')
    expect(req.request.params.get('da')).toBe('2026-01-01')
    expect(req.request.params.get('a')).toBe('2026-03-31')
    expect(req.request.params.get('unitaLocaleId')).toBe('ul-1')
    req.flush(new Blob(['x']), {
      headers: { 'Content-Disposition': 'attachment; filename="estratto-conou.csv"' },
    })
  })

  it('scaricaEstratto senza sede non manda unitaLocaleId', () => {
    service.scaricaEstratto('COBAT', '2026-01-01', '2026-01-31').subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/consorzi/estratto'))
    expect(req.request.params.has('unitaLocaleId')).toBe(false)
    req.flush(new Blob())
  })
})
