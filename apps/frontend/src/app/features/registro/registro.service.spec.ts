import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import {
  RegistroService,
  StatoProgressivoIniziale,
  annoItaliano,
  offrireProgressivoIniziale,
  offrireRegistrazione,
} from './registro.service'
import { environment } from '../../../environments/environment'

describe('RegistroService — progressivo iniziale', () => {
  let service: RegistroService
  let httpMock: HttpTestingController
  const url = `${environment.apiUrl}/registro/progressivo-iniziale`

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RegistroService],
    })
    service = TestBed.inject(RegistroService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => httpMock.verify())

  it("getProgressivoIniziale legge lo stato dell'anno con una GET", () => {
    const stato: StatoProgressivoIniziale = {
      anno: 2026,
      primoProgressivo: null,
      impostatoIl: null,
      haMovimenti: false,
      puoImpostare: true,
      puoRegistrare: true,
    }
    let ricevuto: StatoProgressivoIniziale | undefined
    service.getProgressivoIniziale(2026).subscribe(s => (ricevuto = s))

    const req = httpMock.expectOne(`${url}/2026`)
    expect(req.request.method).toBe('GET')
    req.flush(stato)
    expect(ricevuto).toEqual(stato)
  })

  it('impostaProgressivoIniziale manda numero e motivo con una PUT', () => {
    let ricevuto: unknown
    service
      .impostaProgressivoIniziale(2026, 812, 'Migrazione da WinWaste')
      .subscribe(r => (ricevuto = r))

    const req = httpMock.expectOne(`${url}/2026`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({ primoProgressivo: 812, motivo: 'Migrazione da WinWaste' })
    req.flush({ anno: 2026, primoProgressivo: 812 })
    expect(ricevuto).toEqual({ anno: 2026, primoProgressivo: 812 })
  })
})

describe('offrireProgressivoIniziale', () => {
  const base: StatoProgressivoIniziale = {
    anno: 2026,
    primoProgressivo: null,
    impostatoIl: null,
    haMovimenti: false,
    puoImpostare: true,
    puoRegistrare: true,
  }

  it("si offre solo a chi può impostarlo, se l'anno non ha movimenti né un iniziale", () => {
    expect(offrireProgressivoIniziale(base)).toBeTrue()
    expect(offrireProgressivoIniziale({ ...base, puoImpostare: false })).toBeFalse()
    expect(offrireProgressivoIniziale({ ...base, haMovimenti: true })).toBeFalse()
    expect(offrireProgressivoIniziale({ ...base, primoProgressivo: 812 })).toBeFalse()
    expect(offrireProgressivoIniziale(null)).toBeFalse()
  })
})

describe('offrireRegistrazione', () => {
  const base: StatoProgressivoIniziale = {
    anno: 2026,
    primoProgressivo: null,
    impostatoIl: null,
    haMovimenti: true,
    puoImpostare: false,
    puoRegistrare: true,
  }

  it("nasconde la registrazione a chi è in sola consultazione nell'azienda selezionata", () => {
    expect(offrireRegistrazione(base)).toBeTrue()
    expect(offrireRegistrazione({ ...base, puoRegistrare: false })).toBeFalse()
  })

  it('senza stato dal backend la mostra: decide comunque il backend (403)', () => {
    expect(offrireRegistrazione(null)).toBeTrue()
  })
})

describe('annoItaliano', () => {
  it('cambia anno alla mezzanotte italiana, non a quella UTC', () => {
    expect(annoItaliano(new Date('2026-12-31T22:59:00Z'))).toBe(2026)
    expect(annoItaliano(new Date('2026-12-31T23:00:00Z'))).toBe(2027)
  })
})

describe('RegistroService — registri per sede', () => {
  let service: RegistroService
  let httpMock: HttpTestingController
  const base = `${environment.apiUrl}/registro`

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RegistroService],
    })
    service = TestBed.inject(RegistroService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => httpMock.verify())

  it('registro.service: listRegistri chiama GET registro/registri', () => {
    service.listRegistri().subscribe()
    const req = httpMock.expectOne(`${base}/registri`)
    expect(req.request.method).toBe('GET')
    req.flush([])
  })

  it('registro.service: assicuraRegistri chiama POST registro/registri/assicura', () => {
    service.assicuraRegistri().subscribe()
    const req = httpMock.expectOne(`${base}/registri/assicura`)
    expect(req.request.method).toBe('POST')
    req.flush([])
  })

  it('registro.service: la registrazione invia registroId solo se valorizzato', () => {
    const dto = {
      type: 'CARICO' as const,
      movementDate: '2026-10-26',
      causale: 'PRODUZIONE_INTERNA' as const,
      cerCode: '200301',
      quantity: 1,
    }
    service.registra(dto).subscribe()
    const senza = httpMock.expectOne(base)
    expect('registroId' in senza.request.body).toBeFalse()
    senza.flush({})

    service.registra({ ...dto, registroId: 'reg-A' }).subscribe()
    const con = httpMock.expectOne(base)
    expect(con.request.body.registroId).toBe('reg-A')
    con.flush({})
  })

  it('registro.service: lista e progressivo iniziale passano registroId in query', () => {
    service.lista({ registroId: 'reg-A' }).subscribe()
    const lista = httpMock.expectOne(r => r.url === base && r.params.get('registroId') === 'reg-A')
    lista.flush({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 })

    service.getProgressivoIniziale(2026, 'reg-A').subscribe()
    const get = httpMock.expectOne(
      r => r.url === `${base}/progressivo-iniziale/2026` && r.params.get('registroId') === 'reg-A'
    )
    get.flush({})

    service.impostaProgressivoIniziale(2026, 5, 'motivo valido', 'reg-A').subscribe()
    const put = httpMock.expectOne(
      r =>
        r.method === 'PUT' &&
        r.url === `${base}/progressivo-iniziale/2026` &&
        r.params.get('registroId') === 'reg-A'
    )
    expect(put.request.method).toBe('PUT')
    put.flush({})
  })
})
