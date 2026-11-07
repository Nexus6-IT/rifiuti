import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { environment } from '../../../../environments/environment'
import { ImpostazioniFatturazione44Service } from './impostazioni-fatturazione-4-4.service'

describe('ImpostazioniFatturazione44Service', () => {
  let servizio: ImpostazioniFatturazione44Service
  let http: HttpTestingController
  const cedente = `${environment.apiUrl}/cedente-fatturazione`
  const numerazioni = `${environment.apiUrl}/numerazioni-fattura`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(ImpostazioniFatturazione44Service)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('leggiCedente fa GET /cedente-fatturazione', () => {
    servizio.leggiCedente().subscribe()
    const req = http.expectOne(cedente)
    expect(req.request.method).toBe('GET')
    req.flush({})
  })

  it('salvaCedente fa PUT con il corpo così com’è', () => {
    const dati = { regimeFiscale: 'RF01', statoLiquidazione: 'LN' as const, versione: 2 }
    servizio.salvaCedente(dati).subscribe()
    const req = http.expectOne(cedente)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual(dati)
    req.flush({})
  })

  it('numerazioni fa GET con ?anno=', () => {
    servizio.numerazioni(2026).subscribe()
    const req = http.expectOne(r => r.url === numerazioni)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('anno')).toBe('2026')
    req.flush([])
  })

  it('impostaPartenza fa PUT su /numerazioni-fattura/:registro/:anno', () => {
    const dati = { numeroPartenza: 120, dataPartenza: '2026-03-01', versione: 1 }
    servizio.impostaPartenza('reg-1', 2026, dati).subscribe()
    const req = http.expectOne(`${numerazioni}/reg-1/2026`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual(dati)
    req.flush({})
  })

  it('impostaDefinitive fa PUT su /impostazioni-fatturazione/definitive con attive e versione', () => {
    servizio.impostaDefinitive(true, 3).subscribe()
    const req = http.expectOne(`${environment.apiUrl}/impostazioni-fatturazione/definitive`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({ attive: true, versione: 3 })
    req.flush({ definitiveAttive: true, versione: 4 })
  })
})
