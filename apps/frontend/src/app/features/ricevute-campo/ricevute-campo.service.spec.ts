import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { RicevuteCampoService, nomeFileDa } from './ricevute-campo.service'

describe('RicevuteCampoService', () => {
  let http: HttpTestingController
  let servizio: RicevuteCampoService

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    http = TestBed.inject(HttpTestingController)
    servizio = TestBed.inject(RicevuteCampoService)
  })
  afterEach(() => http.verify())

  it('elenca con la pagina richiesta', () => {
    servizio.elenca(3).subscribe()
    const req = http.expectOne(r => r.url.endsWith('/esiti-campo/ricevute'))
    expect(req.request.params.get('pagina')).toBe('3')
    req.flush({ righe: [], totale: 0 })
  })

  it('scarica il PDF come blob e legge il nome file dall intestazione', () => {
    let nome = ''
    servizio.scarica('abc').subscribe(f => (nome = f.nomeFile))
    const req = http.expectOne(r => r.url.endsWith('/esiti-campo/ricevute/abc/pdf'))
    expect(req.request.responseType).toBe('blob')
    req.flush(new Blob(['%PDF-']), {
      headers: { 'Content-Disposition': 'attachment; filename="ricevuta-ritiro-2026-12-01.pdf"' },
    })
    expect(nome).toBe('ricevuta-ritiro-2026-12-01.pdf')
  })

  it('un nome file con caratteri strani non si usa', () => {
    expect(nomeFileDa('attachment; filename="../../etc/passwd"')).toBeNull()
    expect(nomeFileDa(null)).toBeNull()
    expect(nomeFileDa('attachment; filename="a b.pdf"')).toBeNull()
  })
})
