import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { Observable } from 'rxjs'
import { ClientiService } from './clienti.service'
import { environment } from '../../../environments/environment'

describe('ClientiService', () => {
  let service: ClientiService
  let http: HttpTestingController
  const api = environment.apiUrl
  const ID = '11111111-1111-4111-8111-111111111111'
  const ALLEGATO = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(ClientiService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  const ditta = {
    ragioneSociale: 'Rossi Srl',
    partitaIva: '01234567890',
    codiceFiscale: '01234567890',
    denominazione: 'Sede legale',
    referente: 'Mario',
    indirizzo: { via: 'Via Roma', civico: '1', cap: '00100', comune: 'Roma', provincia: 'RM' },
  }

  // Agenti e clienti hanno la stessa forma: per il test comune si usa un tipo largo.
  interface RuoloComune {
    list(f?: object): Observable<unknown>
    get(id: string): Observable<unknown>
    crea(d: never): Observable<unknown>
    modifica(id: string, d: never): Observable<unknown>
    elimina(id: string, v: number): Observable<unknown>
  }

  for (const [rotta, nome] of [
    ['agenti', 'agenti'],
    ['clienti', 'clienti'],
  ] as const) {
    describe(nome, () => {
      let ruolo: RuoloComune
      beforeEach(() => (ruolo = service[nome] as unknown as RuoloComune))

      it('list: GET paginato con testo, soloAttivi, pagina e dimensione', () => {
        ruolo.list({ testo: 'ros', soloAttivi: true, pagina: 2, dimensione: 20 }).subscribe()
        const req = http.expectOne(r => r.url === `${api}/${rotta}`)
        expect(req.request.method).toBe('GET')
        expect(req.request.params.get('testo')).toBe('ros')
        expect(req.request.params.get('soloAttivi')).toBe('true')
        expect(req.request.params.get('pagina')).toBe('2')
        expect(req.request.params.get('dimensione')).toBe('20')
        req.flush({ elementi: [], totale: 0 })
      })

      it('list senza filtri: nessun parametro', () => {
        ruolo.list().subscribe()
        const req = http.expectOne(r => r.url === `${api}/${rotta}`)
        expect(req.request.params.keys()).toEqual([])
        req.flush({ elementi: [], totale: 0 })
      })

      it('get: GET :id', () => {
        ruolo.get(ID).subscribe()
        const req = http.expectOne(`${api}/${rotta}/${ID}`)
        expect(req.request.method).toBe('GET')
        req.flush({})
      })

      it('crea: POST col corpo', () => {
        ruolo.crea(ditta as never).subscribe()
        const req = http.expectOne(`${api}/${rotta}`)
        expect(req.request.method).toBe('POST')
        expect(req.request.body).toEqual(ditta)
        expect(Object.keys(req.request.body as object).sort()).toEqual(
          [
            'codiceFiscale',
            'denominazione',
            'indirizzo',
            'partitaIva',
            'ragioneSociale',
            'referente',
          ].sort()
        )
        expect((req.request.body as typeof ditta).indirizzo.comune).toBe('Roma')
        req.flush({})
      })

      it('modifica: PATCH :id con versione', () => {
        ruolo.modifica(ID, { versione: 3, attivo: false } as never).subscribe()
        const req = http.expectOne(`${api}/${rotta}/${ID}`)
        expect(req.request.method).toBe('PATCH')
        expect(req.request.body).toEqual({ versione: 3, attivo: false })
        req.flush({})
      })

      it('elimina: DELETE :id?versione=', () => {
        ruolo.elimina(ID, 4).subscribe()
        const req = http.expectOne(r => r.url === `${api}/${rotta}/${ID}`)
        expect(req.request.method).toBe('DELETE')
        expect(req.request.params.get('versione')).toBe('4')
        req.flush(null)
      })
    })
  }

  describe('contratti', () => {
    const base = () => `${api}/contratti-clienti`

    it('list: tutti i filtri come parametri', () => {
      service.contratti
        .list({
          stato: 'ATTIVO',
          clienteId: ID,
          categoriaId: 'c',
          tipoId: 't',
          testo: 'cc',
          inScadenzaEntroGiorni: 30,
          pagina: 1,
          dimensione: 50,
        })
        .subscribe()
      const req = http.expectOne(r => r.url === base())
      expect(req.request.method).toBe('GET')
      const p = req.request.params
      expect(p.get('stato')).toBe('ATTIVO')
      expect(p.get('clienteId')).toBe(ID)
      expect(p.get('categoriaId')).toBe('c')
      expect(p.get('tipoId')).toBe('t')
      expect(p.get('testo')).toBe('cc')
      expect(p.get('inScadenzaEntroGiorni')).toBe('30')
      expect(p.get('pagina')).toBe('1')
      expect(p.get('dimensione')).toBe('50')
      req.flush({ elementi: [], totale: 0 })
    })

    it('list senza filtri: nessun parametro', () => {
      service.contratti.list().subscribe()
      const req = http.expectOne(r => r.url === base())
      expect(req.request.params.keys()).toEqual([])
      req.flush({ elementi: [], totale: 0 })
    })

    it('prossimoNumero: GET prossimo-numero e restituisce la stringa', () => {
      let numero = ''
      service.contratti.prossimoNumero().subscribe(n => (numero = n))
      const req = http.expectOne(`${base()}/prossimo-numero`)
      expect(req.request.method).toBe('GET')
      req.flush({ numero: 'CC-2026-001' })
      expect(numero).toBe('CC-2026-001')
    })

    it('get: GET :id', () => {
      service.contratti.get(ID).subscribe()
      const req = http.expectOne(`${base()}/${ID}`)
      expect(req.request.method).toBe('GET')
      req.flush({})
    })

    it('crea: POST col corpo', () => {
      const dati = { numero: 'CC-1', descrizione: 'd', clienteId: ID, dataInizio: '2026-01-01' }
      service.contratti.crea(dati).subscribe()
      const req = http.expectOne(base())
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual(dati)
      req.flush({})
    })

    it('modifica: PATCH :id con versione', () => {
      service.contratti.modifica(ID, { descrizione: 'x', versione: 2 }).subscribe()
      const req = http.expectOne(`${base()}/${ID}`)
      expect(req.request.method).toBe('PATCH')
      expect(req.request.body).toEqual({ descrizione: 'x', versione: 2 })
      req.flush({})
    })

    it('cambiaStato: PATCH :id/stato con stato, versione e motivo', () => {
      service.contratti
        .cambiaStato(ID, { stato: 'ANNULLATO', versione: 5, motivoAnnulloId: 'm' })
        .subscribe()
      const req = http.expectOne(`${base()}/${ID}/stato`)
      expect(req.request.method).toBe('PATCH')
      expect(req.request.body).toEqual({ stato: 'ANNULLATO', versione: 5, motivoAnnulloId: 'm' })
      req.flush({})
    })

    it('rinnova: POST :id/rinnova con versione', () => {
      service.contratti.rinnova(ID, 6).subscribe()
      const req = http.expectOne(`${base()}/${ID}/rinnova`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ versione: 6 })
      req.flush({})
    })

    it('proroga: POST proroga-scadenze', () => {
      const corpo = { scadutiEntro: '2026-12-31', soloRinnovoAutomatico: true, ancheSospesi: false }
      service.contratti.proroga(corpo).subscribe()
      const req = http.expectOne(`${base()}/proroga-scadenze`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual(corpo)
      req.flush({ prorogati: 3 })
    })

    it('elimina: DELETE :id?versione=', () => {
      service.contratti.elimina(ID, 1).subscribe()
      const req = http.expectOne(r => r.url === `${base()}/${ID}`)
      expect(req.request.method).toBe('DELETE')
      expect(req.request.params.get('versione')).toBe('1')
      req.flush(null)
    })
  })

  describe('allegati', () => {
    const base = () => `${api}/contratti-clienti/${ID}/allegati`

    it('elenco: GET', () => {
      service.allegati.elenco(ID).subscribe()
      const req = http.expectOne(base())
      expect(req.request.method).toBe('GET')
      req.flush([])
    })

    it('carica: POST multipart con allegato e posizione', () => {
      const file = new File(['%PDF-'], 'c.pdf', { type: 'application/pdf' })
      service.allegati.carica(ID, 2, file).subscribe()
      const req = http.expectOne(base())
      expect(req.request.method).toBe('POST')
      const corpo = req.request.body as FormData
      expect(corpo instanceof FormData).toBeTrue()
      expect((corpo.get('allegato') as File).name).toBe('c.pdf')
      expect(corpo.get('posizione')).toBe('2')
      req.flush({})
    })

    it('scarica: GET :allegatoId/contenuto come blob', () => {
      service.allegati.scarica(ID, ALLEGATO).subscribe()
      const req = http.expectOne(`${base()}/${ALLEGATO}/contenuto`)
      expect(req.request.method).toBe('GET')
      expect(req.request.responseType).toBe('blob')
      req.flush(new Blob(['x']))
    })

    it('rimuovi: DELETE :allegatoId', () => {
      service.allegati.rimuovi(ID, ALLEGATO).subscribe()
      const req = http.expectOne(`${base()}/${ALLEGATO}`)
      expect(req.request.method).toBe('DELETE')
      req.flush(null)
    })
  })
})
