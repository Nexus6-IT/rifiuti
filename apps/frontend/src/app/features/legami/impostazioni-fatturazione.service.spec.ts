import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { environment } from '../../../environments/environment'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'

describe('ImpostazioneFatturazioneService', () => {
  const url = `${environment.apiUrl}/impostazioni-fatturazione`
  let servizio: ImpostazioneFatturazioneService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(ImpostazioneFatturazioneService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('leggi fa GET', () => {
    let esito: unknown
    servizio.leggi().subscribe(r => (esito = r))
    const req = http.expectOne(url)
    expect(req.request.method).toBe('GET')
    req.flush({ fatturazioneDa: null, versione: 0, modificatoIl: null })
    expect(esito).toEqual({ fatturazioneDa: null, versione: 0, modificatoIl: null })
  })

  it("salva fa PUT con il corpo così com'è", () => {
    servizio.salva({ fatturazioneDa: '2026-01-01', versione: 2, confermaMovimenti: 3 }).subscribe()
    const req = http.expectOne(url)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({
      fatturazioneDa: '2026-01-01',
      versione: 2,
      confermaMovimenti: 3,
    })
    req.flush({ fatturazioneDa: '2026-01-01', versione: 3, modificatoIl: '2026-11-03' })
  })
})
