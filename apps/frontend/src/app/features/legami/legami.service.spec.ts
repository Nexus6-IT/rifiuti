import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { environment } from '../../../environments/environment'
import { LegamiService } from './legami.service'

describe('LegamiService', () => {
  const base = `${environment.apiUrl}/legami-movimento`
  let servizio: LegamiService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    servizio = TestBed.inject(LegamiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  it('proposta fa POST /proposta con quantità come stringa col punto', () => {
    const dati = {
      causale: 'INGRESSO_ESTERNO',
      type: 'CARICO' as const,
      cerCode: '150101',
      movementDate: '2026-11-03',
      unit: 'KG',
      quantity: '12.5',
      firId: 'f1',
      producerSedeId: 's1',
    }
    servizio.proposta(dati).subscribe()
    const req = http.expectOne(`${base}/proposta`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual(dati)
    req.flush({})
  })

  it('lista fa GET con i soli filtri valorizzati', () => {
    servizio
      .lista({ stato: 'DA_COLLEGARE', clienteId: '', dal: '2026-01-01', pagina: 2 })
      .subscribe()
    const req = http.expectOne(r => r.url === base)
    expect(req.request.method).toBe('GET')
    expect(req.request.params.get('stato')).toBe('DA_COLLEGARE')
    expect(req.request.params.get('dal')).toBe('2026-01-01')
    expect(req.request.params.get('pagina')).toBe('2')
    expect(req.request.params.has('clienteId')).toBe(false)
    req.flush({ elementi: [], totale: 0 })
  })

  it('lista: stati[] in query separati da virgola ed esclusi false come "false"', () => {
    servizio.lista({ stati: ['MANCANTE', 'PROPOSTO'], esclusi: false }).subscribe()
    const req = http.expectOne(r => r.url === base)
    expect(req.request.params.get('stati')).toBe('MANCANTE,PROPOSTO')
    expect(req.request.params.get('esclusi')).toBe('false')
    req.flush({ elementi: [], totale: 0 })
  })

  it('aggiornaContatori scrive il totale nel signal condiviso; con un errore torna a 0', () => {
    servizio.aggiornaContatori()
    http
      .expectOne(`${base}/contatori`)
      .flush({ daCollegare: 9, proposti: 1, mancanti: 5, daRiallineare: 3 })
    expect(servizio.daCollegare()).toBe(9)
    servizio.aggiornaContatori()
    http.expectOne(`${base}/contatori`).flush('x', { status: 500, statusText: 'err' })
    expect(servizio.daCollegare()).toBe(0)
  })

  it('contatori fa GET /contatori', () => {
    servizio.contatori().subscribe()
    const req = http.expectOne(`${base}/contatori`)
    expect(req.request.method).toBe('GET')
    req.flush({ daCollegare: 0, proposti: 0, mancanti: 0, daRiallineare: 0 })
  })

  it('dettaglio fa GET /:id', () => {
    servizio.dettaglio('l1').subscribe()
    const req = http.expectOne(`${base}/l1`)
    expect(req.request.method).toBe('GET')
    req.flush({})
  })

  it('perMovimento fa GET /registro/movimenti/:id/legame', () => {
    servizio.perMovimento('m1').subscribe()
    const req = http.expectOne(`${environment.apiUrl}/registro/movimenti/m1/legame`)
    expect(req.request.method).toBe('GET')
    req.flush({})
  })

  it('modifica fa PUT /:id con versione e righe come stringhe', () => {
    const corpo = {
      versione: 3,
      righe: [{ rigaAddebitoId: 'r1', quantita: '1.5', prezzo: '12.5', sconto: '10+5' }],
    }
    servizio.modifica('l1', corpo).subscribe()
    const req = http.expectOne(`${base}/l1`)
    expect(req.request.method).toBe('PUT')
    expect(req.request.body).toEqual(corpo)
    req.flush({})
  })

  it('conferma fa POST /:id/conferma', () => {
    servizio.conferma('l1', { versione: 2 }).subscribe()
    const req = http.expectOne(`${base}/l1/conferma`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ versione: 2 })
    req.flush({})
  })

  it('escludi fa POST /:id/escludi con motivo', () => {
    servizio.escludi('l1', { versione: 2, motivo: 'Omaggio' }).subscribe()
    const req = http.expectOne(`${base}/l1/escludi`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ versione: 2, motivo: 'Omaggio' })
    req.flush({})
  })

  it('riammetti fa POST /:id/riammetti con versione', () => {
    servizio.riammetti('l1', 4).subscribe()
    const req = http.expectOne(`${base}/l1/riammetti`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ versione: 4 })
    req.flush({})
  })

  it('azioni fa POST /azioni', () => {
    const corpo = { azione: 'CONFERMA' as const, elementi: [{ legameId: 'l1', versione: 1 }] }
    servizio.azioni(corpo).subscribe()
    const req = http.expectOne(`${base}/azioni`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual(corpo)
    req.flush({})
  })

  it('anteprimaAggiornamento fa POST /aggiorna-prezzi senza firma', () => {
    servizio.anteprimaAggiornamento({ contrattoId: 'c1', dal: '2026-01-01' }).subscribe()
    const req = http.expectOne(`${base}/aggiorna-prezzi`)
    expect(req.request.method).toBe('POST')
    expect(req.request.body).toEqual({ perimetro: { contrattoId: 'c1', dal: '2026-01-01' } })
    expect('firma' in (req.request.body as object)).toBe(false)
    req.flush({})
  })

  it('applicaAggiornamento fa POST /aggiorna-prezzi con la firma', () => {
    servizio.applicaAggiornamento({ elencoId: 'e1' }, 'abc').subscribe()
    const req = http.expectOne(`${base}/aggiorna-prezzi`)
    expect(req.request.body).toEqual({ perimetro: { elencoId: 'e1' }, firma: 'abc' })
    req.flush({})
  })

  it('daMovimento fa POST /da-movimento/:id', () => {
    servizio.daMovimento('m1').subscribe()
    const req = http.expectOne(`${base}/da-movimento/m1`)
    expect(req.request.method).toBe('POST')
    req.flush({})
  })
})
