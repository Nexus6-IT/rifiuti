import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { RentriRegistroService, messaggioErroreRentri } from './rentri-registro.service'
import { environment } from '../../../environments/environment'

describe('RentriRegistroService', () => {
  let service: RentriRegistroService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/rentri/registro`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(RentriRegistroService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('registri: GET', () => {
    service.registri().subscribe()
    const r = http.expectOne(`${base}/registri`)
    expect(r.request.method).toBe('GET')
    r.flush({ registri: [], puoConfigurare: false, puoTrasmettere: true })
  })

  it('imposta: PUT con solo i campi indicati', () => {
    service.imposta('r1', { identificativoRentri: 'RABCDE12345' }).subscribe()
    const r = http.expectOne(`${base}/registri/r1`)
    expect(r.request.method).toBe('PUT')
    expect(r.request.body).toEqual({ identificativoRentri: 'RABCDE12345' })
    r.flush({})
  })

  it('allineamento: GET con anno', () => {
    service.allineamento('r1', 2026).subscribe()
    const r = http.expectOne(req => req.url === `${base}/registri/r1/allineamento`)
    expect(r.request.params.get('anno')).toBe('2026')
    r.flush({ locali: 1, trasmessi: 1, suRentri: 1 })
  })

  it('trasmetti: POST con registro e annotazioni', () => {
    service.trasmetti('r1', ['m1', 'm2']).subscribe()
    const r = http.expectOne(`${base}/trasmetti`)
    expect(r.request.method).toBe('POST')
    expect(r.request.body).toEqual({ registroId: 'r1', movimentoIds: ['m1', 'm2'] })
    r.flush({ accodate: 2, saltate: [], avvio: 'AVVIATO' })
  })

  it('trasmettiStorico: POST con conferma true', () => {
    service.trasmettiStorico('r1', 2025).subscribe()
    const r = http.expectOne(`${base}/trasmetti-storico`)
    expect(r.request.body).toEqual({ registroId: 'r1', anno: 2025, conferma: true })
    r.flush({ accodate: 0, saltate: [], avvio: 'NIENTE_DA_INVIARE' })
  })

  it("escludiInvioAutomatico e includiInvioAutomatico: POST con il motivo, senza corpo per l'inclusione", () => {
    service.escludiInvioAutomatico('m1', 'Da correggere').subscribe()
    const e = http.expectOne(`${base}/movimenti/m1/escludi-invio-automatico`)
    expect(e.request.method).toBe('POST')
    expect(e.request.body).toEqual({ motivo: 'Da correggere' })
    e.flush(null, { status: 204, statusText: 'No Content' })

    service.includiInvioAutomatico('m1').subscribe()
    const i = http.expectOne(`${base}/movimenti/m1/includi-invio-automatico`)
    expect(i.request.method).toBe('POST')
    i.flush(null, { status: 204, statusText: 'No Content' })
  })

  it('togliDallaCoda: DELETE; verifica: POST; dichiara: POST', () => {
    service.togliDallaCoda('m1').subscribe()
    const d = http.expectOne(`${base}/movimenti/m1/coda`)
    expect(d.request.method).toBe('DELETE')
    d.flush(null, { status: 204, statusText: 'No Content' })

    service.verifica('m1').subscribe()
    const v = http.expectOne(`${base}/movimenti/m1/verifica`)
    expect(v.request.method).toBe('POST')
    v.flush({ esito: 'TRASMESSA', stato: 'TRASMESSA', messaggio: 'ok' })

    service
      .dichiaraGiaSuRentri({
        registroId: 'r1',
        anno: 2026,
        daProgressivo: 1,
        aProgressivo: 5,
        motivo: 'x',
      })
      .subscribe()
    const g = http.expectOne(`${base}/dichiara-gia-trasmessi`)
    expect(g.request.body.aProgressivo).toBe(5)
    g.flush({ dichiarate: 5, saltate: 0, saltatePerStato: {}, movimentiNellIntervallo: 5 })
  })

  it('messaggioErroreRentri: messaggio del backend (anche lista) o generico', () => {
    expect(messaggioErroreRentri({ error: { message: 'Spiegazione del dominio.' } })).toBe(
      'Spiegazione del dominio.'
    )
    expect(messaggioErroreRentri({ error: { message: ['a', 'b'] } })).toBe('a · b')
    expect(messaggioErroreRentri({})).toContain('non riuscita')
  })
})
