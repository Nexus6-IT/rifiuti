import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { environment } from '../../../environments/environment'
import { FatturazioneService } from './fatturazione.service'
import { NuovaElaborazione } from './fatturazione.model'

describe('FatturazioneService', () => {
  let servizio: FatturazioneService
  let http: HttpTestingController
  const api = environment.apiUrl
  const elab = `${api}/elaborazioni-fatturazione`
  const doc = `${api}/documenti-fattura`

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(FatturazioneService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('avvia: POST /elaborazioni-fatturazione con il corpo così com’è (date AAAA-MM-GG)', () => {
    const dati: NuovaElaborazione = {
      periodoDal: '2026-10-01',
      periodoAl: '2026-10-31',
      dataDocumento: '2026-11-05',
      raggruppamento: 'PER_CONTRATTO',
      includiArretrati: false,
      filtri: { categoriaIds: ['c1'], tipiAddebito: ['CER'] },
    }
    servizio.avvia(dati).subscribe()
    const req = http.expectOne(elab)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual(dati)
    req.flush({})
  })

  it('lista: GET con stato, pagina e dimensione 50 di default', () => {
    servizio.lista({ stato: 'ANTEPRIMA_PRONTA' }).subscribe()
    const req = http.expectOne(r => r.url === elab)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('stato')).toBe('ANTEPRIMA_PRONTA')
    expect(req.request.params.get('pagina')).toBe('1')
    expect(req.request.params.get('dimensione')).toBe('50')
    req.flush({})
  })

  it('dimensione 200 richiesta: il servizio manda 100', () => {
    servizio.lista({ dimensione: 200, pagina: 3 }).subscribe()
    const req = http.expectOne(r => r.url === elab)
    expect(req.request.params.get('dimensione')).toBe('100')
    expect(req.request.params.get('pagina')).toBe('3')
    req.flush({})
  })

  it('dimensione 0 o negativa: il servizio manda 1', () => {
    servizio.documenti({ dimensione: -5 }).subscribe()
    const req = http.expectOne(r => r.url === doc)
    expect(req.request.params.get('dimensione')).toBe('1')
    req.flush({})
  })

  it('dettaglio: GET /elaborazioni-fatturazione/:id', () => {
    servizio.dettaglio('e 1').subscribe()
    const req = http.expectOne(`${elab}/e%201`)
    expect(req.request.method).toBe('GET')
    req.flush({})
  })

  it('documentiElaborazione: GET /:id/documenti paginato', () => {
    servizio.documentiElaborazione('e1', { pagina: 2, dimensione: 25 }).subscribe()
    const req = http.expectOne(r => r.url === `${elab}/e1/documenti`)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('pagina')).toBe('2')
    expect(req.request.params.get('dimensione')).toBe('25')
    req.flush({})
  })

  it('ricalcola e scarta: POST senza dati', () => {
    servizio.ricalcola('e1').subscribe()
    const r1 = http.expectOne(`${elab}/e1/ricalcola`)
    expect(r1.request.method).toBe('POST')
    r1.flush({})
    servizio.scarta('e1').subscribe()
    const r2 = http.expectOne(`${elab}/e1/scarta`)
    expect(r2.request.method).toBe('POST')
    r2.flush({})
  })

  it('escludi e riammetti: POST /:id/documenti/:docId/…', () => {
    servizio.escludi('e1', 'd1').subscribe()
    const r1 = http.expectOne(`${elab}/e1/documenti/d1/escludi`)
    expect(r1.request.method).toBe('POST')
    r1.flush({})
    servizio.riammetti('e1', 'd1').subscribe()
    const r2 = http.expectOne(`${elab}/e1/documenti/d1/riammetti`)
    expect(r2.request.method).toBe('POST')
    r2.flush({})
  })

  it('definitiva: POST con impronta e versione', () => {
    servizio.definitiva('e1', 'abc123', 4).subscribe()
    const req = http.expectOne(`${elab}/e1/definitiva`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ impronta: 'abc123', versione: 4 })
    req.flush({})
  })

  it('documenti: GET con i filtri come stringhe e date AAAA-MM-GG; i vuoti non partono', () => {
    servizio
      .documenti({
        registroIvaId: 'r1',
        anno: 2026,
        stato: 'DEFINITIVO',
        clienteId: 'c1',
        dataDa: '2026-01-01',
        dataA: '2026-12-31',
      })
      .subscribe()
    const req = http.expectOne(r => r.url === doc)
    expect(req.request.method).toBe('GET')
    const p = req.request.params
    expect(p.get('registroIvaId')).toBe('r1')
    expect(p.get('anno')).toBe('2026')
    expect(p.get('stato')).toBe('DEFINITIVO')
    expect(p.get('clienteId')).toBe('c1')
    expect(p.get('dataDa')).toBe('2026-01-01')
    expect(p.get('dataA')).toBe('2026-12-31')
    req.flush({})
    servizio.documenti().subscribe()
    const vuota = http.expectOne(r => r.url === doc)
    expect(vuota.request.params.has('stato')).toBeFalse()
    expect(vuota.request.params.has('anno')).toBeFalse()
    vuota.flush({})
  })

  it('documento: GET /documenti-fattura/:id', () => {
    servizio.documento('d1').subscribe()
    const req = http.expectOne(`${doc}/d1`)
    expect(req.request.method).toBe('GET')
    req.flush({})
  })

  it('annulla: POST con motivo e versione', () => {
    servizio.annulla('d1', 'Errore di battitura', 2).subscribe()
    const req = http.expectOne(`${doc}/d1/annulla`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ motivo: 'Errore di battitura', versione: 2 })
    req.flush({})
  })

  it('storno: POST con motivo, dataDocumento e rifatturabile', () => {
    const dati = { motivo: 'Reso', dataDocumento: '2026-11-05', rifatturabile: true }
    servizio.storno('d1', dati).subscribe()
    const req = http.expectOne(`${doc}/d1/storno`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual(dati)
    req.flush({})
  })

  it('segnaEmesso: POST /:id/emesso', () => {
    servizio.segnaEmesso('d1').subscribe()
    const req = http.expectOne(`${doc}/d1/emesso`)
    expect(req.request.method).toBe('POST')
    req.flush({})
  })

  it('scaricaXml(id, true) manda confermaEmissione: true, risposta blob', () => {
    servizio.scaricaXml('d1', true).subscribe()
    const req = http.expectOne(`${doc}/d1/xml`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ confermaEmissione: true })
    expect(req.request.responseType).toBe('blob')
    req.flush(new Blob(['<xml/>']))
  })

  it('scaricaXml(id, false) manda false: il servizio non la inventa', () => {
    servizio.scaricaXml('d1', false).subscribe()
    const req = http.expectOne(`${doc}/d1/xml`)
    expect(req.request.body).toEqual({ confermaEmissione: false })
    req.flush(new Blob())
  })

  it('pdf: GET /:id/pdf, risposta blob', () => {
    servizio.pdf('d1').subscribe()
    const req = http.expectOne(`${doc}/d1/pdf`)
    expect(req.request.method).toBe('GET')
    expect(req.request.responseType).toBe('blob')
    req.flush(new Blob())
  })

  it('esporta(XML_ZIP, s, true) manda confermaEmissione: true e la selezione', () => {
    const selezione = { registroIvaId: 'r1', anno: 2026, numeroDa: 1, numeroA: 10 }
    servizio.esporta('XML_ZIP', selezione, true).subscribe()
    const req = http.expectOne(`${doc}/export`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ formato: 'XML_ZIP', selezione, confermaEmissione: true })
    expect(req.request.responseType).toBe('blob')
    req.flush(new Blob())
  })

  it('esporta(CSV, s, false) manda false', () => {
    servizio.esporta('CSV', { documentoIds: ['d1', 'd2'] }, false).subscribe()
    const req = http.expectOne(`${doc}/export`)
    expect(req.request.body).toEqual({
      formato: 'CSV',
      selezione: { documentoIds: ['d1', 'd2'] },
      confermaEmissione: false,
    })
    req.flush(new Blob())
  })

  it('scostamenti: GET /scostamenti-fattura paginato', () => {
    servizio.scostamenti({ pagina: 2, dimensione: 500 }).subscribe()
    const req = http.expectOne(r => r.url === `${api}/scostamenti-fattura`)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('dimensione')).toBe('100')
    expect(req.request.params.get('pagina')).toBe('2')
    req.flush({})
  })

  it('presaAtto: POST /legami-movimento/:id/presa-atto-scostamento con la nota', () => {
    servizio.presaAtto('l1', 'Visto con il cliente').subscribe()
    const req = http.expectOne(`${api}/legami-movimento/l1/presa-atto-scostamento`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ nota: 'Visto con il cliente' })
    req.flush(null)
  })
})
