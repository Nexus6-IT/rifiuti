import { TestBed, fakeAsync, tick } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { PeseService, costruisciMultipart, DatiAperturaAccesso } from './pese.service'
import { environment } from '../../../environments/environment'

describe('PeseService', () => {
  let service: PeseService
  let http: HttpTestingController
  const base = `${environment.apiUrl}/pese`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(PeseService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('elenca strumenti e automezzi (con filtro targa)', () => {
    service.elencaStrumenti().subscribe()
    http
      .expectOne(`${base}/strumenti`)
      .flush({ righe: [], puoOperare: true, puoRettificare: false })
    service.elencaAutomezzi().subscribe()
    const senza = http.expectOne(`${base}/automezzi`)
    expect(senza.request.params.keys()).toEqual([])
    senza.flush({ righe: [], puoOperare: true, puoRettificare: false })
    service.elencaAutomezzi('AB123').subscribe()
    const con = http.expectOne(r => r.url === `${base}/automezzi`)
    expect(con.request.params.get('targa')).toBe('AB123')
    con.flush({ righe: [], puoOperare: true, puoRettificare: false })
  })

  it('crea e aggiorna con i corpi attesi', () => {
    service.creaStrumento({ descrizione: 'Pesa' }).subscribe()
    expect(http.expectOne(`${base}/strumenti`).request.method).toBe('POST')
    service.aggiornaStrumento('s1', { descrizione: 'Pesa' }).subscribe()
    expect(http.expectOne(`${base}/strumenti/s1`).request.method).toBe('PUT')
    service.creaAutomezzo({ targa: 'AB123CD' }).subscribe()
    expect(http.expectOne(`${base}/automezzi`).request.method).toBe('POST')
    service.aggiornaAutomezzo('a1', { targa: 'AB123CD' }).subscribe()
    expect(http.expectOne(`${base}/automezzi/a1`).request.method).toBe('PUT')
  })

  it('la tara viaggia come { taraKg } oppure { pesataId }', () => {
    service.impostaTara('a1', { taraKg: 12.5 }).subscribe()
    const r1 = http.expectOne(`${base}/automezzi/a1/tara`)
    expect(r1.request.method).toBe('PUT')
    expect(r1.request.body).toEqual({ taraKg: 12.5 })
    service.impostaTara('a1', { pesataId: 'p1' }).subscribe()
    expect(http.expectOne(`${base}/automezzi/a1/tara`).request.body).toEqual({ pesataId: 'p1' })
  })

  it('elencaAccessi manda solo i filtri valorizzati', () => {
    service.elencaAccessi({ stato: 'APERTO', targa: '', pagina: 2 }).subscribe()
    const r = http.expectOne(x => x.url === `${base}/accessi`)
    expect(r.request.params.get('stato')).toBe('APERTO')
    expect(r.request.params.get('pagina')).toBe('2')
    expect(r.request.params.has('targa')).toBeFalse()
    r.flush({ righe: [], totale: 0, puoOperare: false, puoRettificare: false })
  })

  it('apriAccesso e multipart: dati = JSON, allegato = Blob', () => {
    const dati: DatiAperturaAccesso = {
      chiaveIdempotenza: 'k',
      verso: 'CARICO',
      modo: 'DOPPIA',
      pesata: { pesoKg: 12.5, motivo: 'm', stabileDichiarato: true },
    }
    const blob = new Blob(['abc'], { type: 'application/pdf' })
    service.apriAccesso(dati, blob).subscribe()
    const r = http.expectOne(`${base}/accessi`)
    const f = r.request.body as FormData
    expect(f instanceof FormData).toBeTrue()
    expect(JSON.parse(f.get('dati') as string)).toEqual(dati)
    expect(f.get('allegato') instanceof Blob).toBeTrue()
    r.flush({})
  })

  it('senza allegato il multipart ha solo dati', () => {
    const f = costruisciMultipart({ a: 1 })
    expect(f.has('allegato')).toBeFalse()
    expect(f.get('dati')).toBe('{"a":1}')
  })

  it('rotte di rettifica, annullo, collegamenti e allegati', () => {
    service.rettificaPesata('p1', { pesoNuovoKg: 9, motivo: 'm' }).subscribe()
    expect(http.expectOne(`${base}/pesate/p1/rettifiche`).request.method).toBe('POST')
    service
      .secondaPesata('a1', {
        chiaveIdempotenza: 'k',
        pesata: { pesoKg: 1, motivo: 'm', stabileDichiarato: true },
      })
      .subscribe()
    expect(http.expectOne(`${base}/accessi/a1/seconda-pesata`).request.method).toBe('POST')
    service.annullaAccesso('a1', 'errore').subscribe()
    expect(http.expectOne(`${base}/accessi/a1/annulla`).request.body).toEqual({ motivo: 'errore' })
    service.collega('a1', { tipo: 'FIR', firId: 'f1' }).subscribe()
    expect(http.expectOne(`${base}/accessi/a1/collegamenti`).request.body).toEqual({
      tipo: 'FIR',
      firId: 'f1',
    })
    service.revocaCollegamento('c1', 'sbagliato').subscribe()
    expect(http.expectOne(`${base}/collegamenti/c1/revoca`).request.body).toEqual({
      motivo: 'sbagliato',
    })
    service.dettaglioAccesso('a1').subscribe()
    http.expectOne(`${base}/accessi/a1`)
  })

  it("l'allegato si scarica via HttpClient come blob e si apre da un object URL", fakeAsync(() => {
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    spyOn(URL, 'createObjectURL').and.returnValue('blob:abc')
    const revoca = spyOn(URL, 'revokeObjectURL')
    service.apriAllegato('x').subscribe()
    const r = http.expectOne(`${base}/allegati/x`)
    expect(r.request.responseType).toBe('blob')
    r.flush(new Blob(['pdf']))
    expect(scheda.location.href).toBe('blob:abc')
    tick(60_000)
    expect(revoca).toHaveBeenCalledWith('blob:abc')
  }))

  it('se lo scaricamento fallisce la scheda aperta si chiude', () => {
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    let errore: unknown
    service.apriAllegato('x').subscribe({ error: e => (errore = e) })
    http
      .expectOne(`${base}/allegati/x`)
      .error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' })
    expect(scheda.close).toHaveBeenCalled()
    expect(errore).toBeTruthy()
  })

  it('il nome del file arriva al multipart', () => {
    service
      .rettificaPesata('p1', { pesoNuovoKg: 9, motivo: 'm' }, new Blob(['x']), 'foto.jpg')
      .subscribe()
    const r = http.expectOne(`${base}/pesate/p1/rettifiche`)
    expect((r.request.body as FormData).get('allegato') as File).toEqual(
      jasmine.objectContaining({ name: 'foto.jpg' })
    )
    r.flush({})
  })

  it('agenti: elenco, creazione, nuovo codice, revoca e assegnazione', () => {
    service.elencaAgenti().subscribe()
    expect(http.expectOne(`${base}/agenti`).request.method).toBe('GET')
    service.creaAgente({ descrizione: 'PC pesa', registroId: 'r1' }).subscribe()
    const c = http.expectOne(`${base}/agenti`)
    expect(c.request.method).toBe('POST')
    expect(c.request.body).toEqual({ descrizione: 'PC pesa', registroId: 'r1' })
    service.nuovoCodiceAgente('g1').subscribe()
    expect(http.expectOne(`${base}/agenti/g1/codice`).request.method).toBe('POST')
    service.revocaAgente('g1', 'PC sostituito').subscribe()
    expect(http.expectOne(`${base}/agenti/g1/revoca`).request.body).toEqual({
      motivo: 'PC sostituito',
    })
    service.assegnaStrumento('s1', null).subscribe()
    const a = http.expectOne(`${base}/strumenti/s1/agente`)
    expect(a.request.method).toBe('PUT')
    expect(a.request.body).toEqual({ agenteId: null })
  })

  it('letture: manda solo i filtri valorizzati', () => {
    service.elencaLetture({ registroId: 'r1', libere: true, dal: '' }).subscribe()
    const r = http.expectOne(x => x.url === `${base}/letture`)
    expect(r.request.params.get('registroId')).toBe('r1')
    expect(r.request.params.get('libere')).toBe('true')
    expect(r.request.params.has('dal')).toBeFalse()
    r.flush({ righe: [] })
  })

  it('apre un accesso da una lettura: il corpo porta solo letturaId', () => {
    service
      .apriAccesso({
        chiaveIdempotenza: 'k',
        verso: 'CARICO',
        modo: 'DOPPIA',
        pesata: { letturaId: 'l1' },
      })
      .subscribe()
    const r = http.expectOne(`${base}/accessi`)
    expect(JSON.parse((r.request.body as FormData).get('dati') as string).pesata).toEqual({
      letturaId: 'l1',
    })
    r.flush({})
  })
})
