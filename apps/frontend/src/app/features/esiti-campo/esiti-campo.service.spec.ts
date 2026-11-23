import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { EsitiCampoService } from './esiti-campo.service'

describe('EsitiCampoService: foto', () => {
  let servizio: EsitiCampoService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(EsitiCampoService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('scarica i byte con HttpClient (Bearer dell interceptor), come blob', () => {
    let ricevuto: Blob | undefined
    servizio.scaricaFoto('f1').subscribe(b => (ricevuto = b))
    const r = http.expectOne(req => req.url.endsWith('/esiti-campo/foto/f1'))
    expect(r.request.method).toBe('GET')
    expect(r.request.responseType).toBe('blob')
    r.flush(new Blob(['x'], { type: 'image/jpeg' }))
    expect(ricevuto?.size).toBe(1)
  })

  it('apriFoto apre subito la scheda, poi le da l indirizzo; in errore la chiude', () => {
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    spyOn(URL, 'createObjectURL').and.returnValue('blob:prova')
    servizio.apriFoto('f1').subscribe()
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    http.expectOne(req => req.url.endsWith('/foto/f1')).flush(new Blob(['x']))
    expect(scheda.location.href).toBe('blob:prova')

    const scheda2 = { location: { href: '' }, close: jasmine.createSpy('close') }
    ;(window.open as jasmine.Spy).and.returnValue(scheda2 as unknown as Window)
    servizio.apriFoto('f2').subscribe({ error: () => undefined })
    http
      .expectOne(req => req.url.endsWith('/foto/f2'))
      .flush(new Blob(['no']), { status: 404, statusText: 'Not Found' })
    expect(scheda2.close).toHaveBeenCalled()
  })
})
