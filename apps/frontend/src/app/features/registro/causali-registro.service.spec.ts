import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { CausaliRegistroService, OpzioneCausaleApi } from './causali-registro.service'
import { environment } from '../../../environments/environment'

function riga(codice: string, descrizione = codice): OpzioneCausaleApi {
  return {
    codice,
    descrizione,
    origine: 'SISTEMA',
    ruoloMud: 'ESCLUSO',
    codiceRentri: null,
    operazione: null,
    versioneId: null,
  }
}

describe('CausaliRegistroService', () => {
  let servizio: CausaliRegistroService
  let http: HttpTestingController
  const url = `${environment.apiUrl}/registro/causali`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(CausaliRegistroService)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('chiede le opzioni con tipo e giorno come parametri e restituisce le causali', () => {
    let ricevute: OpzioneCausaleApi[] | undefined
    servizio.opzioni('SCARICO', '2026-10-20').subscribe(c => (ricevute = c))

    const req = http.expectOne(r => r.url === url)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('tipo')).toBe('SCARICO')
    // il giorno parte com'è, senza passare da una Date (nessuno spostamento di fuso)
    expect(req.request.params.get('data')).toBe('2026-10-20')
    req.flush({
      tipo: 'SCARICO',
      data: '2026-10-20',
      causali: [riga('CESSIONE', 'Cessione a terzi')],
    })

    expect(ricevute).toEqual([riga('CESSIONE', 'Cessione a terzi')])
  })

  it('senza giorno non invia il parametro data (decide il backend)', () => {
    servizio.opzioni('CARICO').subscribe()
    const req = http.expectOne(r => r.url === url)
    expect(req.request.params.has('data')).toBeFalse()
    req.flush({ tipo: 'CARICO', data: '2026-10-27', causali: [] })
  })

  it('tiene in cache per tipo e giorno, anche con la richiesta ancora in corso', () => {
    const a: OpzioneCausaleApi[][] = []
    servizio.opzioni('CARICO', '2026-10-20').subscribe(c => a.push(c))
    servizio.opzioni('CARICO', '2026-10-20').subscribe(c => a.push(c))
    const req = http.expectOne(r => r.url === url)
    req.flush({ tipo: 'CARICO', data: '2026-10-20', causali: [riga('A')] })
    // una terza lettura a richiesta conclusa non rifa la richiesta
    servizio.opzioni('CARICO', '2026-10-20').subscribe(c => a.push(c))
    http.expectNone(r => r.url === url)
    expect(a.length).toBe(3)

    // un altro giorno o un altro tipo sono chiavi diverse
    servizio.opzioni('CARICO', '2026-10-21').subscribe()
    servizio.opzioni('SCARICO', '2026-10-20').subscribe()
    const altre = http.match(r => r.url === url)
    expect(altre.length).toBe(2)
    altre.forEach(r => r.flush({ tipo: 'CARICO', data: '', causali: [] }))
  })

  it('invalida() svuota la cache: la lettura successiva rifa la richiesta', () => {
    servizio.opzioni('CARICO', '2026-10-20').subscribe()
    http.expectOne(r => r.url === url).flush({ tipo: 'CARICO', data: '', causali: [riga('A')] })

    servizio.invalida()

    let ricevute: OpzioneCausaleApi[] | undefined
    servizio.opzioni('CARICO', '2026-10-20').subscribe(c => (ricevute = c))
    http.expectOne(r => r.url === url).flush({ tipo: 'CARICO', data: '', causali: [riga('B')] })
    expect(ricevute?.map(c => c.codice)).toEqual(['B'])
  })

  it('una richiesta fallita non resta in cache', () => {
    let errore: unknown
    servizio.opzioni('CARICO', '2026-10-20').subscribe({ error: e => (errore = e) })
    http.expectOne(r => r.url === url).flush('boom', { status: 500, statusText: 'Server Error' })
    expect(errore).toBeTruthy()

    let ricevute: OpzioneCausaleApi[] | undefined
    servizio.opzioni('CARICO', '2026-10-20').subscribe(c => (ricevute = c))
    http.expectOne(r => r.url === url).flush({ tipo: 'CARICO', data: '', causali: [riga('A')] })
    expect(ricevute?.length).toBe(1)
  })

  describe('gestione (ADMIN)', () => {
    it('ogni scrittura usa verbo e URL giusti e invalida la cache delle opzioni', () => {
      servizio.opzioni('CARICO', '2026-10-20').subscribe()
      http.expectOne(r => r.url === url).flush({ tipo: 'CARICO', data: '', causali: [] })

      servizio.disattivaSistema('CARICO', 'X').subscribe()
      const put = http.expectOne(url + '/sistema/CARICO/X/disattivazione')
      expect(put.request.method).toBe('PUT')
      put.flush(null)
      // cache invalidata: nuova richiesta
      servizio.opzioni('CARICO', '2026-10-20').subscribe()
      http.expectOne(r => r.url === url).flush({ tipo: 'CARICO', data: '', causali: [] })

      servizio.riattivaSistema('SCARICO', 'Y').subscribe()
      expect(http.expectOne(url + '/sistema/SCARICO/Y/disattivazione').request.method).toBe(
        'DELETE'
      )
      servizio.modifica('id1', { codiceRentri: null }).subscribe()
      const patch = http.expectOne(url + '/aziendali/id1')
      expect(patch.request.method).toBe('PATCH')
      expect(patch.request.body).toEqual({ codiceRentri: null })
      servizio.chiudi('id1', '2026-12-31').subscribe()
      const chiusura = http.expectOne(url + '/aziendali/id1/chiusura')
      expect(chiusura.request.method).toBe('PUT')
      expect(chiusura.request.body).toEqual({ validaAl: '2026-12-31' })
    })
  })
})
