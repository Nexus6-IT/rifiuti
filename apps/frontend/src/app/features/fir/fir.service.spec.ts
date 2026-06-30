import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { signal } from '@angular/core'
import { FirService, CreateFIRDto } from './fir.service'
import { FIR, FIRStato, PaginatedFIRResponse } from '../../shared/models/fir.model'
import { AuthService, User } from '../../core/services/auth.service'

describe('FirService', () => {
  let service: FirService
  let httpMock: HttpTestingController

  const mockUser: User = {
    id: 'user-1',
    email: 'operatore@example.com',
    firstName: 'Mario',
    lastName: 'Rossi',
  }

  const authStub = {
    currentUser: signal<User | null>(mockUser),
  }

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
      providers: [FirService, { provide: AuthService, useValue: authStub }],
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
          req.url === '/api/fir' &&
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
        req => req.url === '/api/fir' && req.params.get('stato') === FIRStato.BOZZA
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

      const req = httpMock.expectOne('/api/fir/fir-1')
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

      const req = httpMock.expectOne('/api/fir')
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual(createDto)
      req.flush(mockFIR)
    })
  })

  describe('emettiFIR', () => {
    it('should emit FIR with firmaProduttore', done => {
      const emessoFIR = { ...mockFIR, stato: FIRStato.EMESSO }

      service.emettiFIR('fir-1').subscribe({
        next: fir => {
          expect(fir.stato).toBe(FIRStato.EMESSO)
          done()
        },
      })

      const req = httpMock.expectOne('/api/fir/fir-1/emetti')
      expect(req.request.method).toBe('POST')
      expect(req.request.body.firmaProduttore).toEqual({
        firmatario: 'Mario Rossi',
        certificato: 'FIRMA-NON-QUALIFICATA',
      })
      req.flush(emessoFIR)
    })
  })

  describe('presaInCarico', () => {
    it('should take FIR in charge with firmaTrasportatore', done => {
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

      const req = httpMock.expectOne('/api/fir/fir-1/presa-in-carico')
      expect(req.request.method).toBe('POST')
      expect(req.request.body.firmaTrasportatore.certificato).toBe('FIRMA-NON-QUALIFICATA')
      req.flush(inTransitoFIR)
    })
  })

  describe('confermaConsegna', () => {
    it('should confirm delivery on /conferma-consegna with peso and firmaDestinatario', done => {
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

      const req = httpMock.expectOne('/api/fir/fir-1/conferma-consegna')
      expect(req.request.method).toBe('POST')
      expect(req.request.body.pesoEffettivo).toBe(95)
      expect(req.request.body.firmaDestinatario.certificato).toBe('FIRMA-NON-QUALIFICATA')
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

      const req = httpMock.expectOne('/api/fir/fir-1/annulla')
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ motivo: "Annullato dall'operatore" })
      req.flush(annullatoFIR)
    })
  })
})
