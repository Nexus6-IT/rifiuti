import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { GiacenzeService, DatiSoglie } from './giacenze.service'
import { environment } from '../../../environments/environment'

describe('GiacenzeService', () => {
  let service: GiacenzeService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/giacenze`
  const soglie = `${base}/deposito-temporaneo/soglie`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(GiacenzeService)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('getGiacenze senza registro non manda parametri', () => {
    service.getGiacenze().subscribe()
    const req = http.expectOne(base)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.keys()).toEqual([])
    req.flush([])
  })

  it('getGiacenze con registro manda registroId', () => {
    service.getGiacenze('r1').subscribe()
    const req = http.expectOne(r => r.url === base)
    expect(req.request.params.get('registroId')).toBe('r1')
    req.flush([])
  })

  it('getDepositoTemporaneo legge la vista, con e senza registroId', () => {
    service.getDepositoTemporaneo().subscribe()
    const senza = http.expectOne(`${base}/deposito-temporaneo`)
    expect(senza.request.params.keys()).toEqual([])
    senza.flush({ oggi: '2026-10-30', registri: [] })

    service.getDepositoTemporaneo('r2').subscribe()
    const con = http.expectOne(r => r.url === `${base}/deposito-temporaneo`)
    expect(con.request.params.get('registroId')).toBe('r2')
    con.flush({ oggi: '2026-10-30', registri: [] })
  })

  it('getSoglie e le rotte delle soglie', () => {
    service.getSoglie().subscribe()
    http.expectOne(soglie).flush({})

    const dati: DatiSoglie = {
      criterio: 'TEMPORALE',
      giorniMax: null,
      kgMaxTotale: 30000,
      kgMaxPericolosi: 10000,
      preavvisoGiorni: 15,
      preavvisoPercentuale: 80,
    }
    service.impostaSoglie(null, dati).subscribe()
    const azienda = http.expectOne(soglie)
    expect(azienda.request.method).toBe('PUT')
    expect(azienda.request.body).toEqual(dati)
    azienda.flush({})

    service.impostaSoglie('r1', dati).subscribe()
    const reg = http.expectOne(`${soglie}/registri/r1`)
    expect(reg.request.method).toBe('PUT')
    reg.flush({})

    service.eliminaSoglie(null).subscribe()
    const delAzienda = http.expectOne(soglie)
    expect(delAzienda.request.method).toBe('DELETE')
    delAzienda.flush(null)

    service.eliminaSoglie('r1').subscribe()
    const delReg = http.expectOne(`${soglie}/registri/r1`)
    expect(delReg.request.method).toBe('DELETE')
    delReg.flush(null)
  })
})
