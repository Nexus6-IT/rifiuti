import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import {
  MudControllo,
  MudService,
  RiepilogoAvvisi,
  StatoPresentazioneMud,
  codiciAvvisi,
  puoGenerareConAvvisi,
  testoConferma,
} from './mud.service'
import { environment } from '../../../environments/environment'

const API_URL = `${environment.apiUrl}/mud`

const riepilogo = (r: Partial<RiepilogoAvvisi> = {}): RiepilogoAvvisi => ({
  kgInMeno: 0,
  kgInPiu: 0,
  movimentiNonQuantificati: 0,
  voci: [],
  testo: '',
  cambianoQuantita: false,
  ...r,
})

const STATO: StatoPresentazioneMud = {
  year: 2025,
  status: 'DRAFT',
  submittedAt: null,
  datiModificatiDopoPresentazione: false,
  fileTracciato: null,
  esportazioni: [],
}

describe('MudService', () => {
  let service: MudService
  let httpMock: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [MudService],
    })

    service = TestBed.inject(MudService)
    httpMock = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    httpMock.verify()
  })

  it('downloadExport fa GET su /mud/export con anno e avvisi confermati separati da virgola', () => {
    service.downloadExport(2025, ['A', 'B']).subscribe()

    const req = httpMock.expectOne(r => r.url === `${API_URL}/export`)
    expect(req.request.method).toBe('GET')
    expect(req.request.responseType).toBe('blob')
    expect(req.request.params.get('year')).toBe('2025')
    expect(req.request.params.get('avvisiConfermati')).toBe('A,B')
    req.flush(new Blob(['XX;']))
  })

  it('downloadExport senza avvisi non manda il parametro avvisiConfermati', () => {
    service.downloadExport(2025, []).subscribe()

    const req = httpMock.expectOne(r => r.url === `${API_URL}/export`)
    expect(req.request.params.get('year')).toBe('2025')
    expect(req.request.params.has('avvisiConfermati')).toBeFalse()
    req.flush(new Blob(['XX;']))
  })

  it('getPresentazione fa GET su /mud/:year/presentazione', done => {
    service.getPresentazione(2025).subscribe(res => {
      expect(res).toEqual(STATO)
      done()
    })

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('GET')
    req.flush(STATO)
  })

  it('segnaPresentato fa POST con data ed esportazione scelta, senza avvisi confermati', () => {
    service.segnaPresentato(2025, '2026-06-30', '2026-04-02T08:00:00.000Z').subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({
      dataPresentazione: '2026-06-30',
      esportazioneGenerataIl: '2026-04-02T08:00:00.000Z',
    })
    req.flush(STATO)
  })

  it('segnaPresentato senza data né esportazione manda un corpo vuoto', () => {
    service.segnaPresentato(2025).subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({})
    req.flush(STATO)
  })

  it('annullaPresentazione fa DELETE con il motivo nel corpo', () => {
    service.annullaPresentazione(2025, 'DICHIARAZIONE_DA_SOSTITUIRE').subscribe()

    const req = httpMock.expectOne(`${API_URL}/2025/presentazione`)
    expect(req.request.method).toBe('DELETE')
    expect(req.request.body).toEqual({ motivo: 'DICHIARAZIONE_DA_SOSTITUIRE' })
    req.flush(STATO)
  })

  it('getObbligo fa GET su /mud/obbligo', done => {
    const obbligo = {
      mudNonDovuto: false,
      motivo: null,
      impostatoIl: null,
      impostatoDa: null,
      puoModificare: true,
    }
    service.getObbligo().subscribe(res => {
      expect(res).toEqual(obbligo)
      done()
    })

    const req = httpMock.expectOne(`${API_URL}/obbligo`)
    expect(req.request.method).toBe('GET')
    req.flush(obbligo)
  })

  it('impostaObbligo fa PUT con flag e motivo', () => {
    service.impostaObbligo(true, 'Meno di 10 dipendenti').subscribe()

    const req = httpMock.expectOne(`${API_URL}/obbligo`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual({ mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' })
    req.flush({})
  })

  it('impostaObbligo senza motivo non manda il campo', () => {
    service.impostaObbligo(false, null).subscribe()

    const req = httpMock.expectOne(`${API_URL}/obbligo`)
    expect(req.request.body).toEqual({ mudNonDovuto: false })
    req.flush({})
  })
})

describe('codiciAvvisi', () => {
  it('restituisce i codici distinti degli avvisi in ordine alfabetico, senza i bloccanti', () => {
    const controlli: MudControllo[] = [
      { codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO', messaggio: 'a' },
      { codice: 'CAUSALE_ESCLUSA', gravita: 'AVVISO', messaggio: 'b' },
      { codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO', messaggio: 'c' },
      { codice: 'DESTINATARIO_SENZA_CF', gravita: 'BLOCCANTE', messaggio: 'd' },
    ]

    expect(codiciAvvisi(controlli)).toEqual(['CAUSALE_ESCLUSA', 'SCARICO_SENZA_FIR'])
  })
})

describe('testoConferma', () => {
  it('con soli kg in meno', () => {
    expect(testoConferma(riepilogo({ kgInMeno: 350 }), 'generare il file')).toBe(
      'Confermo di generare il file con 350 kg in meno rispetto al registro.'
    )
  })

  it('con kg in meno e in più, in formato italiano con il raggruppamento', () => {
    expect(
      testoConferma(riepilogo({ kgInMeno: 1234.5, kgInPiu: 36 }), 'segnare il MUD come presentato')
    ).toBe(
      'Confermo di segnare il MUD come presentato con 1.234,5 kg in meno e 36 kg in più rispetto al registro.'
    )
  })

  it('senza differenze di quantità', () => {
    expect(testoConferma(riepilogo(), 'generare il file')).toBe(
      'Ho letto gli avvisi e confermo di generare il file.'
    )
  })
})

describe('puoGenerareConAvvisi', () => {
  // Stessa regola della 403 del backend (riepilogaAvvisi.cambianoQuantita, Task 5): la pagina
  // non la ricalcola, legge il flag del riepilogo
  it('chiunque, se gli avvisi non cambiano le quantità', () => {
    expect(puoGenerareConAvvisi(riepilogo({ cambianoQuantita: false }), 'VIEWER')).toBeTrue()
  })

  it('solo un amministratore effettivo, se gli avvisi cambiano le quantità', () => {
    const r = riepilogo({ cambianoQuantita: true })
    expect(puoGenerareConAvvisi(r, 'VIEWER')).toBeFalse()
    expect(puoGenerareConAvvisi(r, 'OPERATOR')).toBeFalse()
    expect(puoGenerareConAvvisi(r, 'ADMIN')).toBeTrue()
    expect(puoGenerareConAvvisi(r, 'SUPER_ADMIN')).toBeTrue()
  })
})
