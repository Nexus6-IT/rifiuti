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
