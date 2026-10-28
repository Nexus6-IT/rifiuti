import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import {
  RegistroService,
  StatoProgressivoIniziale,
  DatiGiacenzaIniziale,
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

describe('RegistroService — giacenze iniziali', () => {
  let service: RegistroService
  let httpMock: HttpTestingController
  const url = `${environment.apiUrl}/registro/giacenze-iniziali`

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RegistroService],
    })
    service = TestBed.inject(RegistroService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => httpMock.verify())

  it("getGiacenzeIniziali legge l'elenco con registroId in query", () => {
    service.getGiacenzeIniziali('r-1').subscribe()
    const req = httpMock.expectOne(r => r.url === url)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('registroId')).toBe('r-1')
    req.flush({ registroId: 'r-1', puoImpostare: true, voci: [] })
  })

  it('senza registro non manda registroId', () => {
    service.getGiacenzeIniziali().subscribe()
    const req = httpMock.expectOne(r => r.url === url)
    expect(req.request.params.has('registroId')).toBeFalse()
    req.flush({ registroId: null, puoImpostare: false, voci: [] })
  })

  it('creaGiacenzaIniziale fa una POST col corpo e registroId in query', () => {
    const dati: DatiGiacenzaIniziale = {
      cerCode: '17 04 05',
      quantita: 120,
      unita: 'KG',
      dataRiferimento: '2026-01-01',
    }
    service.creaGiacenzaIniziale(dati, 'r-1').subscribe()
    const req = httpMock.expectOne(r => r.url === url)
    expect(req.request.method).toBe('POST')
    expect(req.request.params.get('registroId')).toBe('r-1')
    expect(req.request.body).toEqual(dati)
    req.flush({ giacenza: {}, avvisi: [] })
  })

  it("modificaGiacenzaIniziale fa una PUT sull'id senza query", () => {
    service
      .modificaGiacenzaIniziale('abc', { quantita: 5, unita: 'T', dataRiferimento: '2026-02-01' })
      .subscribe()
    const req = httpMock.expectOne(`${url}/abc`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({ quantita: 5, unita: 'T', dataRiferimento: '2026-02-01' })
    req.flush({ giacenza: {} })
  })

  it("eliminaGiacenzaIniziale fa una DELETE sull'id", () => {
    service.eliminaGiacenzaIniziale('abc').subscribe()
    const req = httpMock.expectOne(`${url}/abc`)
    expect(req.request.method).toBe('DELETE')
    req.flush(null)
  })
})

describe('RegistroService - rettifica, annullamento, verifica della catena', () => {
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

  it('rettifica: POST movimenti/:id/rettifica con il corpo così com’è', () => {
    const corpo = {
      movementDate: '2026-10-20',
      causale: 'PRODUZIONE_INTERNA' as const,
      cerCode: '17 04 05',
      quantity: 50,
      unit: 'KG',
      motivo: 'Peso errato',
      confermaAnnoPresentato: true,
    }
    let esito: unknown
    service.rettifica('abc-1', corpo).subscribe(e => (esito = e))
    const req = httpMock.expectOne(`${base}/movimenti/abc-1/rettifica`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual(corpo)
    req.flush({ movimento: { id: 'n1' }, avvisi: ['attenzione'] })
    expect(esito).toEqual({ movimento: { id: 'n1' }, avvisi: ['attenzione'] })
  })

  it('annulla: POST movimenti/:id/annullamento con motivo e conferma', () => {
    service.annulla('abc-1', { motivo: 'Doppione' }).subscribe()
    const req = httpMock.expectOne(`${base}/movimenti/abc-1/annullamento`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ motivo: 'Doppione' })
    req.flush({ movimento: { id: 'n2' }, avvisi: [] })

    service.annulla('abc-2', { motivo: 'x', confermaAnnoPresentato: true }).subscribe()
    const req2 = httpMock.expectOne(`${base}/movimenti/abc-2/annullamento`)
    expect(req2.request.body).toEqual({ motivo: 'x', confermaAnnoPresentato: true })
    req2.flush({ movimento: { id: 'n3' }, avvisi: [] })
  })

  it('l’id viene codificato nell’URL', () => {
    service.annulla('a/b', { motivo: 'x' }).subscribe()
    const req = httpMock.expectOne(`${base}/movimenti/a%2Fb/annullamento`)
    expect(req.request.method).toBe('POST')
    req.flush({})
  })

  it('verificaCatena: GET con anno e, se c’è, registroId', () => {
    service.verificaCatena(2026, 'r1').subscribe()
    const req = httpMock.expectOne(r => r.url === `${base}/verifica-catena`)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('anno')).toBe('2026')
    expect(req.request.params.get('registroId')).toBe('r1')
    req.flush({
      registroId: 'r1',
      anno: 2026,
      verificate: 0,
      nonVerificabili: [],
      primoErrore: null,
    })

    service.verificaCatena(2026).subscribe()
    const req2 = httpMock.expectOne(r => r.url === `${base}/verifica-catena`)
    expect(req2.request.params.has('registroId')).toBeFalse()
    req2.flush({})
  })
})
