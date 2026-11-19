import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'

describe('ConfigurazioneSdiService', () => {
  let servizio: ConfigurazioneSdiService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(ConfigurazioneSdiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  const richiesta = (metodo: string, fine: string) =>
    http.expectOne(r => r.method === metodo && r.url.endsWith(fine))

  it('leggi: GET /sdi/configurazione', () => {
    servizio.leggi().subscribe()
    const r = richiesta('GET', '/sdi/configurazione')
    expect(r.request.method).toBe('GET')
    r.flush({})
  })

  it('salva: PUT con il corpo', () => {
    const dati = { provider: 'fake', ambiente: 'SANDBOX', versione: 0 }
    servizio.salva(dati).subscribe()
    const r = richiesta('PUT', '/sdi/configurazione')
    expect(r.request.body).toEqual(dati)
    r.flush({})
  })

  it('verifica: POST /verifica; token: POST /token con la versione', () => {
    servizio.verifica().subscribe()
    richiesta('POST', '/sdi/configurazione/verifica').flush({})
    servizio.rigeneraToken(3).subscribe()
    const r = richiesta('POST', '/sdi/configurazione/token')
    expect(r.request.body).toEqual({ versione: 3 })
    r.flush({})
  })

  it('invio-attivo e onboarding: PUT con versione', () => {
    servizio.impostaInvioAttivo(true, 2).subscribe()
    const a = richiesta('PUT', '/sdi/configurazione/invio-attivo')
    expect(a.request.body).toEqual({ attivo: true, versione: 2 })
    a.flush({})
    servizio.impostaPasso('CONTRATTO_PROVIDER', true, 2).subscribe()
    const b = richiesta('PUT', '/sdi/configurazione/onboarding')
    expect(b.request.body).toEqual({ passo: 'CONTRATTO_PROVIDER', fatto: true, versione: 2 })
    b.flush({})
  })
})
