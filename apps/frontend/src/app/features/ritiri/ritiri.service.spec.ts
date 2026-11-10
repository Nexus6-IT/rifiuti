import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { environment } from '../../../environments/environment'
import { NuovoRitiro } from './ritiri.model'
import { RitiriService } from './ritiri.service'

describe('RitiriService', () => {
  let service: RitiriService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/ritiri`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(RitiriService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('elenca manda solo i filtri valorizzati', () => {
    service
      .elenca({ dal: '2026-11-01', cerCode: '', statoVisibile: 'DA_GENERARE', pagina: 2 })
      .subscribe()
    const r = http.expectOne(x => x.url === base)
    expect(r.request.method).toBe('GET')
    expect(r.request.params.get('dal')).toBe('2026-11-01')
    expect(r.request.params.get('statoVisibile')).toBe('DA_GENERARE')
    expect(r.request.params.get('pagina')).toBe('2')
    expect(r.request.params.has('cerCode')).toBeFalse()
    r.flush({ righe: [], totale: 0 })
  })

  it('dettaglio legge /ritiri/:id', () => {
    service.dettaglio('r1').subscribe()
    expect(http.expectOne(`${base}/r1`).request.method).toBe('GET')
  })

  it('crea porta chiave di idempotenza e ripetizione nel corpo', () => {
    const dati = {
      chiaveIdempotenza: 'k-1',
      ripetizione: { ogniSettimane: 1, fino: '2026-12-01' },
    } as unknown as NuovoRitiro
    service.crea(dati).subscribe()
    const r = http.expectOne(base)
    expect(r.request.method).toBe('POST')
    expect(r.request.body.chiaveIdempotenza).toBe('k-1')
    expect(r.request.body.ripetizione).toEqual({ ogniSettimane: 1, fino: '2026-12-01' })
  })

  it('modifica, annulla, non eseguito e riprogramma portano la versione', () => {
    service.modifica('r1', { versione: 3 } as never).subscribe()
    const m = http.expectOne(`${base}/r1`)
    expect(m.request.method).toBe('PUT')
    expect(m.request.body.versione).toBe(3)

    service.annulla('r1', 'cliente chiuso', 3).subscribe()
    const a = http.expectOne(`${base}/r1/annulla`)
    expect(a.request.method).toBe('POST')
    expect(a.request.body).toEqual({ motivo: 'cliente chiuso', versione: 3 })

    service.nonEseguito('r1', 'mezzo guasto', 3).subscribe()
    expect(http.expectOne(`${base}/r1/non-eseguito`).request.body).toEqual({
      motivo: 'mezzo guasto',
      versione: 3,
    })

    service.riprogramma('r1', '2026-11-20', 4).subscribe()
    expect(http.expectOne(`${base}/r1/riprogramma`).request.body).toEqual({
      dataPrevista: '2026-11-20',
      versione: 4,
    })
  })

  it('generaFir manda gli id dei ritiri', () => {
    service.generaFir(['a', 'b']).subscribe()
    const r = http.expectOne(`${base}/genera-fir`)
    expect(r.request.method).toBe('POST')
    expect(r.request.body).toEqual({ ritiroIds: ['a', 'b'] })
  })
})
