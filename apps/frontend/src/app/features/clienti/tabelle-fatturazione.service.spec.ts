import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { Observable } from 'rxjs'
import { TabelleFatturazioneService } from './tabelle-fatturazione.service'
import { environment } from '../../../environments/environment'

describe('TabelleFatturazioneService', () => {
  let service: TabelleFatturazioneService
  let http: HttpTestingController
  const api = environment.apiUrl
  const ID = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(TabelleFatturazioneService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  const cartelle: [string, 'condizioni' | 'conti' | 'spese' | 'registri' | 'testi'][] = [
    ['condizioni-pagamento', 'condizioni'],
    ['conti-correnti', 'conti'],
    ['spese-accessorie', 'spese'],
    ['registri-iva', 'registri'],
    ['testi-fatturazione', 'testi'],
  ]

  // Le cinque tabelle hanno la stessa forma: per il test comune si usa un tipo largo.
  interface TabellaComune {
    list(f?: { incluseDisattivate?: boolean }): Observable<unknown>
    get(id: string): Observable<unknown>
    crea(d: never): Observable<unknown>
    modifica(id: string, d: never): Observable<unknown>
    elimina(id: string, v: number): Observable<unknown>
  }

  for (const [rotta, nome] of cartelle) {
    describe(nome, () => {
      let tabella: TabellaComune
      beforeEach(() => (tabella = service[nome] as unknown as TabellaComune))

      it('list senza filtri: GET senza parametri', () => {
        tabella.list().subscribe()
        const req = http.expectOne(r => r.url === `${api}/${rotta}`)
        expect(req.request.method).toBe('GET')
        expect(req.request.params.keys()).toEqual([])
        req.flush([])
      })

      it('list con disattivate: ?incluseDisattivate=true', () => {
        tabella.list({ incluseDisattivate: true }).subscribe()
        const req = http.expectOne(r => r.url === `${api}/${rotta}`)
        expect(req.request.params.get('incluseDisattivate')).toBe('true')
        req.flush([])
      })

      it('get: GET :id', () => {
        tabella.get(ID).subscribe()
        const req = http.expectOne(`${api}/${rotta}/${ID}`)
        expect(req.request.method).toBe('GET')
        req.flush({})
      })

      it('crea: POST con il corpo', () => {
        tabella.crea({ codice: 'X' } as never).subscribe()
        const req = http.expectOne(`${api}/${rotta}`)
        expect(req.request.method).toBe('POST')
        expect(req.request.body).toEqual({ codice: 'X' })
        req.flush({})
      })

      it('modifica: PATCH :id con il corpo (versione inclusa)', () => {
        tabella.modifica(ID, { versione: 3 } as never).subscribe()
        const req = http.expectOne(`${api}/${rotta}/${ID}`)
        expect(req.request.method).toBe('PATCH')
        expect(req.request.body).toEqual({ versione: 3 })
        req.flush({})
      })

      it('elimina: DELETE :id?versione=', () => {
        tabella.elimina(ID, 4).subscribe()
        const req = http.expectOne(r => r.url === `${api}/${rotta}/${ID}`)
        expect(req.request.method).toBe('DELETE')
        expect(req.request.params.get('versione')).toBe('4')
        req.flush(null)
      })
    })
  }

  it('spese.list con tipo: ?tipo=BOLLO', () => {
    service.spese.list({ tipo: 'BOLLO' }).subscribe()
    const req = http.expectOne(r => r.url === `${api}/spese-accessorie`)
    expect(req.request.params.get('tipo')).toBe('BOLLO')
    req.flush([])
  })

  describe('codifiche', () => {
    const rotta = `${api}/codifiche-contratto`

    it('list: GET ?genere= (e disattivate)', () => {
      service.codifiche.list('CATEGORIA', true).subscribe()
      const req = http.expectOne(r => r.url === rotta)
      expect(req.request.method).toBe('GET')
      expect(req.request.params.get('genere')).toBe('CATEGORIA')
      expect(req.request.params.get('incluseDisattivate')).toBe('true')
      req.flush([])
    })

    it('list senza disattivate: niente incluseDisattivate', () => {
      service.codifiche.list('TIPO').subscribe()
      const req = http.expectOne(r => r.url === rotta)
      expect(req.request.params.has('incluseDisattivate')).toBeFalse()
      req.flush([])
    })

    it('prossimoCodice: GET prossimo-codice?genere=', () => {
      let codice = ''
      service.codifiche.prossimoCodice('MOTIVO_ANNULLO').subscribe(r => (codice = r))
      const req = http.expectOne(r => r.url === `${rotta}/prossimo-codice`)
      expect(req.request.method).toBe('GET')
      expect(req.request.params.get('genere')).toBe('MOTIVO_ANNULLO')
      req.flush({ codice: '002' })
      expect(codice).toBe('002')
    })

    it('get: GET :id', () => {
      service.codifiche.get(ID).subscribe()
      const req = http.expectOne(`${rotta}/${ID}`)
      expect(req.request.method).toBe('GET')
      req.flush({})
    })

    it('crea: POST', () => {
      service.codifiche.crea({ genere: 'TIPO', descrizione: 'Rifiuti' }).subscribe()
      const req = http.expectOne(rotta)
      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ genere: 'TIPO', descrizione: 'Rifiuti' })
      req.flush({})
    })

    it('modifica: PATCH :id', () => {
      service.codifiche.modifica(ID, { attiva: false, versione: 2 }).subscribe()
      const req = http.expectOne(`${rotta}/${ID}`)
      expect(req.request.method).toBe('PATCH')
      expect(req.request.body).toEqual({ attiva: false, versione: 2 })
      req.flush({})
    })

    it('elimina: DELETE :id?versione=', () => {
      service.codifiche.elimina(ID, 5).subscribe()
      const req = http.expectOne(r => r.url === `${rotta}/${ID}`)
      expect(req.request.method).toBe('DELETE')
      expect(req.request.params.get('versione')).toBe('5')
      req.flush(null)
    })
  })
})
