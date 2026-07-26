import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import {
  RentriModalitaLegameService,
  RentriModalitaLegameStatus,
} from './rentri-modalita-legame.service'
import { environment } from '../../../environments/environment'

const API_URL = `${environment.apiUrl}/rentri/modalita-legame`

describe('RentriModalitaLegameService', () => {
  let service: RentriModalitaLegameService
  let httpMock: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RentriModalitaLegameService],
    })

    service = TestBed.inject(RentriModalitaLegameService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    httpMock.verify()
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })

  it('getStatus fa GET su /rentri/modalita-legame', done => {
    const mockResponse: RentriModalitaLegameStatus = {
      modalitaLegame: 'MANUALE',
      certificatoConfigurato: false,
    }

    service.getStatus().subscribe(res => {
      expect(res).toEqual(mockResponse)
      done()
    })

    const req = httpMock.expectOne(API_URL)
    expect(req.request.method).toBe('GET')
    req.flush(mockResponse)
  })

  it('setModalita fa PATCH con il body { modalitaLegame }', done => {
    const mockResponse: RentriModalitaLegameStatus = {
      modalitaLegame: 'IBRIDA',
      certificatoConfigurato: true,
    }

    service.setModalita('IBRIDA').subscribe(res => {
      expect(res).toEqual(mockResponse)
      done()
    })

    const req = httpMock.expectOne(API_URL)
    expect(req.request.method).toBe('PATCH')
    expect(req.request.body).toEqual({ modalitaLegame: 'IBRIDA' })
    req.flush(mockResponse)
  })
})
