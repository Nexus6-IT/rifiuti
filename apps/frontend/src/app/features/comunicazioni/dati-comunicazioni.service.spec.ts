import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { environment } from '../../../environments/environment'
import { DatiComunicazioniService } from './dati-comunicazioni.service'
import { erroriDaRisposta } from './dati-comunicazioni.model'

describe('DatiComunicazioniService', () => {
  let servizio: DatiComunicazioniService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/comunicazioni/dati`

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
    servizio = TestBed.inject(DatiComunicazioniService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('dati del movimento: GET, PUT col corpo come sta, DELETE', () => {
    servizio.datiMovimento('m1', 'CONOU').subscribe()
    http
      .expectOne({ method: 'GET', url: `${base}/movimenti/m1/CONOU` })
      .flush({ dati: null, puoModificare: true })

    servizio.impostaDatiMovimento('m1', 'COBAT', { tipoMovimento: 3 }).subscribe()
    const put = http.expectOne({ method: 'PUT', url: `${base}/movimenti/m1/COBAT` })
    expect(put.request.body).toEqual({ tipoMovimento: 3 })
    put.flush({})

    servizio.cancellaDatiMovimento('m1', 'ORR').subscribe()
    http.expectOne({ method: 'DELETE', url: `${base}/movimenti/m1/ORR` }).flush(null)
  })

  it('anagrafica della sede ditta: GET e PUT', () => {
    servizio.anagraficaSede('s1').subscribe()
    http.expectOne({ method: 'GET', url: `${base}/sedi-ditta/s1` }).flush({})
    servizio.impostaAnagraficaSede('s1', { codiceAteco: '38.11.00' }).subscribe()
    const put = http.expectOne({ method: 'PUT', url: `${base}/sedi-ditta/s1` })
    expect(put.request.body).toEqual({ codiceAteco: '38.11.00' })
    put.flush({})
  })

  it('configurazione della sede: GET e PUT per consorzio', () => {
    servizio.configurazione('u1', 'ORSO').subscribe()
    http.expectOne({ method: 'GET', url: `${base}/sedi/u1/ORSO` }).flush({})
    servizio.impostaConfigurazione('u1', 'ORSO', { modalita: 'DETTAGLIATA' }).subscribe()
    const put = http.expectOne({ method: 'PUT', url: `${base}/sedi/u1/ORSO` })
    expect(put.request.body).toEqual({ modalita: 'DETTAGLIATA' })
    put.flush({})
  })
})

describe('erroriDaRisposta', () => {
  it('prende details.errori, altrimenti il messaggio, altrimenti niente', () => {
    expect(erroriDaRisposta({ error: { details: { errori: ['a', 'b', 3] } } })).toEqual(['a', 'b'])
    expect(erroriDaRisposta({ error: { message: 'm' } })).toEqual(['m'])
    expect(erroriDaRisposta(null)).toEqual([])
    expect(erroriDaRisposta({})).toEqual([])
  })
})
