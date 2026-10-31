import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { AbbinamentiService } from './abbinamenti.service'
import { environment } from '../../../environments/environment'

describe('AbbinamentiService', () => {
  let service: AbbinamentiService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/abbinamenti`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(AbbinamentiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('vista: GET con registroId', () => {
    service.vista('r1').subscribe()
    const req = http.expectOne(r => r.url === base)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('registroId')).toBe('r1')
    req.flush({})
  })

  it('differenze: GET con registroId e, se dato, cerCode', () => {
    service.differenze('r1').subscribe()
    const a = http.expectOne(r => r.url === `${base}/differenze`)
    expect(a.request.params.keys()).toEqual(['registroId'])
    a.flush([])
    service.differenze('r1', '99 99 11').subscribe()
    const b = http.expectOne(r => r.url === `${base}/differenze`)
    expect(b.request.params.get('cerCode')).toBe('99 99 11')
    b.flush([])
  })

  it('proposta: GET sullo scarico', () => {
    service.proposta('s1').subscribe()
    const req = http.expectOne(`${base}/scarichi/s1/proposta`)
    expect(req.request.method).toBe('GET')
    req.flush({})
  })

  it('salva: PUT con le righe', () => {
    const righe = [{ caricoId: 'c1', quantita: 10.5 }]
    service.salva('s1', righe).subscribe()
    const req = http.expectOne(`${base}/scarichi/s1`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({ righe })
    req.flush({ scarico: {}, avvisi: [] })
  })

  it('ricalcola: POST con modalita', () => {
    service.ricalcola({ registroId: 'r1', modalita: 'NON_ABBINATI' }).subscribe()
    const req = http.expectOne(`${base}/ricalcolo`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ registroId: 'r1', modalita: 'NON_ABBINATI' })
    req.flush({})
  })
})
