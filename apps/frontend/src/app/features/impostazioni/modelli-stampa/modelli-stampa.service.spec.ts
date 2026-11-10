import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { environment } from '../../../../environments/environment'
import { DatiModelloStampa } from './modello-stampa.model'
import { ModelliStampaService } from './modelli-stampa.service'

const url = `${environment.apiUrl}/modelli-stampa`
const dati: DatiModelloStampa = {
  nome: 'FIR standard',
  ambito: 'FIR',
  copie: 2,
  testoIntestazione: null,
  testoPiePagina: null,
  colorePrimario: '#112233',
  coloreSecondario: '#445566',
  logoBase64: null,
}

describe('ModelliStampaService', () => {
  let s: ModelliStampaService
  let http: HttpTestingController
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    s = TestBed.inject(ModelliStampaService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('elenco: GET', () => {
    s.elenco().subscribe()
    expect(http.expectOne(url).request.method).toBe('GET')
  })

  it('crea: POST con i dati', () => {
    s.crea(dati).subscribe()
    const r = http.expectOne(url)
    expect(r.request.method).toBe('POST')
    expect(r.request.body).toEqual(dati)
  })

  it('modifica: PUT con la versione letta', () => {
    s.modifica('a/b', dati, 4).subscribe()
    const r = http.expectOne(`${url}/a%2Fb`)
    expect(r.request.method).toBe('PUT')
    expect(r.request.body).toEqual({ ...dati, versione: 4 })
  })

  it('predefinito: POST con la versione', () => {
    s.rendiPredefinito('m1', 2).subscribe()
    const r = http.expectOne(`${url}/m1/predefinito`)
    expect(r.request.method).toBe('POST')
    expect(r.request.body).toEqual({ versione: 2 })
  })

  it('elimina: DELETE con la versione nei parametri', () => {
    s.elimina('m1', 3).subscribe()
    const r = http.expectOne(req => req.url === `${url}/m1`)
    expect(r.request.method).toBe('DELETE')
    expect(r.request.params.get('versione')).toBe('3')
  })
})
