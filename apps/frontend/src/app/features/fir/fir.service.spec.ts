import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { FirService, CreateFIRDto } from './fir.service'
import { FIR, FIRStato, PaginatedFIRResponse } from '../../shared/models/fir.model'
import { environment } from '../../../environments/environment'

// Il service risolve le rotte su `${environment.apiUrl}/fir` (es. /api/v1/fir),
// non su '/api/fir': manteniamo il matcher allineato per non seguire un drift
// di URL che nasconderebbe rotte realmente sbagliate.
const FIR_API_URL = `${environment.apiUrl}/fir`

describe('FirService', () => {
  let service: FirService
  let httpMock: HttpTestingController

  const mockFIR: FIR = {
    id: 'fir-1',
    numeroProgressivo: '001',
    anno: 2024,
    stato: FIRStato.BOZZA,
    produttoreId: 'prod-1',
    trasportatoreId: 'trasp-1',
    destinatarioId: 'dest-1',
    rifiuto: {
      cerCode: '150101',
      quantita: 100,
      unitaMisura: 'kg',
    },
    createdAt: '2024-01-01T00:00:00Z',
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FirService],
    })

    service = TestBed.inject(FirService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    httpMock.verify()
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })

  describe('getFIRList', () => {
    it('should fetch paginated FIR list', done => {
      const mockResponse: PaginatedFIRResponse = {
        items: [mockFIR],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      }

      service.getFIRList(1, 10).subscribe({
        next: response => {
          expect(response).toEqual(mockResponse)
          expect(response.items.length).toBe(1)
          done()
        },
      })

      const req = httpMock.expectOne(
        req =>
          req.url === FIR_API_URL &&
          req.params.get('page') === '1' &&
          req.params.get('limit') === '10'
      )
      expect(req.request.method).toBe('GET')
      req.flush(mockResponse)
    })

    it('should filter by stato', done => {
      const mockResponse: PaginatedFIRResponse = {
        items: [mockFIR],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      }

      service.getFIRList(1, 10, FIRStato.BOZZA).subscribe({
        next: response => {
          expect(response).toEqual(mockResponse)
          done()
        },
      })

      const req = httpMock.expectOne(
        req => req.url === FIR_API_URL && req.params.get('stato') === FIRStato.BOZZA
      )
      req.flush(mockResponse)
    })
  })

  describe('getFIRById', () => {
    it('should fetch single FIR by ID', done => {
      service.getFIRById('fir-1').subscribe({
        next: fir => {
          expect(fir).toEqual(mockFIR)
          done()
        },
      })

      const req = httpMock.expectOne(`${FIR_API_URL}/fir-1`)
      expect(req.request.method).toBe('GET')
      req.flush(mockFIR)
    })
  })

  describe('createFIR', () => {
    it('should create new FIR with quantita field', done => {
      const createDto: CreateFIRDto = {
        produttoreId: 'prod-1',
        trasportatoreId: 'trasp-1',
        destinatarioId: 'dest-1',
        rifiuto: {
          cerCode: '150101',
          quantita: 100,
          unitaMisura: 'kg',
        },
      }

      service.createFIR(createDto).subscribe({
        next: fir => {
          expect(fir).toEqual(mockFIR)
          done()
        },
      })

      const req = httpMock.expectOne(FIR_API_URL)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual(createDto)
      req.flush(mockFIR)
    })
  })

  describe('emettiFIR', () => {
    it('non costruisce alcuna firma: chiede solo al backend di emettere e firmare', done => {
      const emessoFIR = { ...mockFIR, stato: FIRStato.EMESSO }

      service.emettiFIR('fir-1').subscribe({
        next: fir => {
          expect(fir.stato).toBe(FIRStato.EMESSO)
          done()
        },
      })

      const req = httpMock.expectOne(`${FIR_API_URL}/fir-1/emetti`)
      expect(req.request.method).toBe('POST')
      // Il frontend non deve costruire firme: il body non porta alcuna firma,
      // la produce e la persiste il backend (sottosistema crittografico).
      expect(req.request.body).toEqual({})
      req.flush(emessoFIR)
    })
  })

  describe('presaInCarico', () => {
    it('non costruisce alcuna firma: chiede solo al backend di prendere in carico e firmare', done => {
      const inTransitoFIR = {
        ...mockFIR,
        stato: FIRStato.IN_TRANSITO,
        dataPresaCarico: '2024-01-02T00:00:00Z',
      }

      service.presaInCarico('fir-1').subscribe({
        next: fir => {
          expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
          expect(fir.dataPresaCarico).toBeTruthy()
          done()
        },
      })

      const req = httpMock.expectOne(`${FIR_API_URL}/fir-1/presa-in-carico`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({})
      req.flush(inTransitoFIR)
    })
  })

  describe('confermaConsegna', () => {
    it('invia solo il peso effettivo: la firma del destinatario la produce il backend', done => {
      const consegnatoFIR = {
        ...mockFIR,
        stato: FIRStato.CONSEGNATO,
        dataConsegna: '2024-01-03T00:00:00Z',
        pesoEffettivo: 95,
      }

      service.confermaConsegna('fir-1', 95).subscribe({
        next: fir => {
          expect(fir.stato).toBe(FIRStato.CONSEGNATO)
          expect(fir.pesoEffettivo).toBe(95)
          done()
        },
      })

      const req = httpMock.expectOne(`${FIR_API_URL}/fir-1/conferma-consegna`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ pesoEffettivo: 95 })
      req.flush(consegnatoFIR)
    })
  })

  describe('annullaFIR', () => {
    it('should cancel FIR with motivo', done => {
      const annullatoFIR = { ...mockFIR, stato: FIRStato.ANNULLATO }

      service.annullaFIR('fir-1', "Annullato dall'operatore").subscribe({
        next: fir => {
          expect(fir.stato).toBe(FIRStato.ANNULLATO)
          done()
        },
      })

      const req = httpMock.expectOne(`${FIR_API_URL}/fir-1/annulla`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ motivo: "Annullato dall'operatore" })
      req.flush(annullatoFIR)
    })
  })

  describe('modificaFIR', () => {
    it('invia un PUT su /fir/:id con tutti i campi e la versione letta', () => {
      const dto = {
        produttoreId: 'p1',
        trasportatoreId: 't1',
        destinatarioId: 'd1',
        provenienza: 'SPECIALE' as const,
        tipoTrattaPrincipale: 'TERRESTRE' as const,
        rifiuto: { cerCode: '150101', quantita: 12, unitaMisura: 't' },
        versione: 3,
      }
      let risposta: FIR | undefined
      service.modificaFIR('fir-1', dto).subscribe(r => (risposta = r))

      const req = httpMock.expectOne(`${FIR_API_URL}/fir-1`)
      expect(req.request.method).toBe('PUT')
      expect(req.request.body).toEqual(dto)
      expect(req.request.body.versione).toBe(3)
      req.flush({ ...mockFIR, versione: 4 })
      expect(risposta?.versione).toBe(4)
    })
  })
})
