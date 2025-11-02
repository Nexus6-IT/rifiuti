import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FirService, CreateFIRDto, UpdateFIRDto } from './fir.service';
import { FIR, FIRStato, PaginatedFIRResponse } from '../../shared/models/fir.model';

describe('FirService', () => {
  let service: FirService;
  let httpMock: HttpTestingController;

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
      quantitaDichiarata: 100,
      unitaMisura: 'kg'
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FirService]
    });

    service = TestBed.inject(FirService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getFIRList', () => {
    it('should fetch paginated FIR list', (done) => {
      const mockResponse: PaginatedFIRResponse = {
        items: [mockFIR],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1
      };

      service.getFIRList(1, 10).subscribe({
        next: (response) => {
          expect(response).toEqual(mockResponse);
          expect(response.items.length).toBe(1);
          done();
        }
      });

      const req = httpMock.expectOne(req =>
        req.url === '/api/fir' &&
        req.params.get('page') === '1' &&
        req.params.get('limit') === '10'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should filter by stato', (done) => {
      const mockResponse: PaginatedFIRResponse = {
        items: [mockFIR],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1
      };

      service.getFIRList(1, 10, FIRStato.BOZZA).subscribe({
        next: (response) => {
          expect(response).toEqual(mockResponse);
          done();
        }
      });

      const req = httpMock.expectOne(req =>
        req.url === '/api/fir' &&
        req.params.get('stato') === FIRStato.BOZZA
      );
      req.flush(mockResponse);
    });
  });

  describe('getFIRById', () => {
    it('should fetch single FIR by ID', (done) => {
      service.getFIRById('fir-1').subscribe({
        next: (fir) => {
          expect(fir).toEqual(mockFIR);
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir/fir-1');
      expect(req.request.method).toBe('GET');
      req.flush(mockFIR);
    });
  });

  describe('createFIR', () => {
    it('should create new FIR', (done) => {
      const createDto: CreateFIRDto = {
        anno: 2024,
        produttoreId: 'prod-1',
        trasportatoreId: 'trasp-1',
        destinatarioId: 'dest-1',
        rifiuto: {
          cerCode: '150101',
          quantitaDichiarata: 100,
          unitaMisura: 'kg'
        }
      };

      service.createFIR(createDto).subscribe({
        next: (fir) => {
          expect(fir).toEqual(mockFIR);
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(mockFIR);
    });
  });

  describe('updateFIR', () => {
    it('should update existing FIR', (done) => {
      const updateDto: UpdateFIRDto = {
        stato: FIRStato.EMESSO
      };

      const updatedFIR = { ...mockFIR, stato: FIRStato.EMESSO };

      service.updateFIR('fir-1', updateDto).subscribe({
        next: (fir) => {
          expect(fir.stato).toBe(FIRStato.EMESSO);
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir/fir-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(updateDto);
      req.flush(updatedFIR);
    });
  });

  describe('emettiFIR', () => {
    it('should emit FIR', (done) => {
      const emessoFIR = { ...mockFIR, stato: FIRStato.EMESSO };

      service.emettiFIR('fir-1').subscribe({
        next: (fir) => {
          expect(fir.stato).toBe(FIRStato.EMESSO);
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir/fir-1/emetti');
      expect(req.request.method).toBe('POST');
      req.flush(emessoFIR);
    });
  });

  describe('presaInCarico', () => {
    it('should take FIR in charge', (done) => {
      const inTransitoFIR = {
        ...mockFIR,
        stato: FIRStato.IN_TRANSITO,
        dataPresaCarico: '2024-01-02T00:00:00Z'
      };

      service.presaInCarico('fir-1').subscribe({
        next: (fir) => {
          expect(fir.stato).toBe(FIRStato.IN_TRANSITO);
          expect(fir.dataPresaCarico).toBeTruthy();
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir/fir-1/presa-in-carico');
      expect(req.request.method).toBe('POST');
      req.flush(inTransitoFIR);
    });
  });

  describe('consegnaFIR', () => {
    it('should deliver FIR', (done) => {
      const consegnatoFIR = {
        ...mockFIR,
        stato: FIRStato.CONSEGNATO,
        dataConsegna: '2024-01-03T00:00:00Z',
        pesoEffettivo: 95
      };

      service.consegnaFIR('fir-1', 95).subscribe({
        next: (fir) => {
          expect(fir.stato).toBe(FIRStato.CONSEGNATO);
          expect(fir.pesoEffettivo).toBe(95);
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir/fir-1/consegna');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.pesoEffettivo).toBe(95);
      req.flush(consegnatoFIR);
    });
  });

  describe('deleteFIR', () => {
    it('should delete FIR', (done) => {
      service.deleteFIR('fir-1').subscribe({
        next: () => {
          done();
        }
      });

      const req = httpMock.expectOne('/api/fir/fir-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
