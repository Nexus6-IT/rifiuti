import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { RentriEsportazioniService } from './rentri-esportazioni.service'
import { environment } from '../../../environments/environment'

describe('RentriEsportazioniService (eREGI E7)', () => {
  let service: RentriEsportazioniService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/rentri/registro`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(RentriEsportazioniService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('elenco: GET', () => {
    service.elenco('r1').subscribe()
    const r = http.expectOne(`${base}/registri/r1/esportazioni`)
    expect(r.request.method).toBe('GET')
    r.flush({ esportazioni: [], automaticaAttiva: false })
  })

  it('genera: POST senza corpo sull elenco del registro', () => {
    service.genera('r1').subscribe()
    const r = http.expectOne(`${base}/registri/r1/esportazioni`)
    expect(r.request.method).toBe('POST')
    r.flush({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null })
  })

  it('rivalida e sostituisci: POST sull esportazione', () => {
    service.rivalida('e1').subscribe()
    const a = http.expectOne(`${base}/esportazioni/e1/rivalida`)
    expect(a.request.method).toBe('POST')
    a.flush({ id: 'e1', stato: 'VALIDATA', messaggi: [] })
    service.sostituisci('e1').subscribe()
    const b = http.expectOne(`${base}/esportazioni/e1/sostituisci`)
    expect(b.request.method).toBe('POST')
    b.flush({ sostituite: 2, ultimaValidaId: null })
  })

  it('scarica: blob con il nome file del Content-Disposition', done => {
    service.scarica('e1').subscribe(f => {
      expect(f.nomeFile).toBe('RENR1234ABCDE0_000001_000003_20260401.SignedR.xml')
      expect(f.blob.size).toBeGreaterThan(0)
      done()
    })
    const r = http.expectOne(`${base}/esportazioni/e1/file`)
    expect(r.request.responseType).toBe('blob')
    r.flush(new Blob(['<reg:Registro/>']), {
      headers: {
        'Content-Disposition':
          'attachment; filename="RENR1234ABCDE0_000001_000003_20260401.SignedR.xml"',
      },
    })
  })

  it('scarica: senza intestazione il nome e null (decide il chiamante)', done => {
    service.scarica('e1').subscribe(f => {
      expect(f.nomeFile).toBeNull()
      done()
    })
    http.expectOne(`${base}/esportazioni/e1/file`).flush(new Blob(['x']))
  })
})
