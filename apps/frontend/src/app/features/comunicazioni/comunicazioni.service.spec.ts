import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ComunicazioniService } from './comunicazioni.service'

describe('ComunicazioniService', () => {
  let service: ComunicazioniService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(ComunicazioniService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it("l'anteprima chiama GET /comunicazioni/orso/anteprima con sede e anno", () => {
    service.anteprimaOrso('ul-1', 2026).subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/orso/anteprima'))
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('unitaLocaleId')).toBe('ul-1')
    expect(req.request.params.get('anno')).toBe('2026')
    req.flush({})
  })

  it('genera con POST /comunicazioni/orso { unitaLocaleId, anno }', () => {
    service.generaOrso('ul-1', 2026).subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/orso'))
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ unitaLocaleId: 'ul-1', anno: 2026 })
    req.flush({})
  })

  it('lo storico filtra per consorzio ORSO, sede e anno', () => {
    service.storicoOrso('ul-1', 2026).subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni'))
    expect(req.request.params.get('consorzio')).toBe('ORSO')
    expect(req.request.params.get('unitaLocaleId')).toBe('ul-1')
    expect(req.request.params.get('anno')).toBe('2026')
    req.flush([])
  })

  it('scarica il file come blob e legge il nome da Content-Disposition', () => {
    let nome: string | null = null
    service.scaricaFile('c1').subscribe(f => (nome = f.nomeFile))
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/c1/file'))
    expect(req.request.responseType).toBe('blob')
    req.flush(new Blob(['<x/>']), {
      headers: { 'Content-Disposition': 'attachment; filename="ImpiantoMesi_2026.xml"' },
    })
    expect(nome as string | null).toBe('ImpiantoMesi_2026.xml')
  })

  it('segna inviata con POST /comunicazioni/:id/inviata', () => {
    service.segnaInviata('c1').subscribe()
    const req = http.expectOne(r => r.url.endsWith('/comunicazioni/c1/inviata'))
    expect(req.request.method).toBe('POST')
    req.flush({})
  })
})
