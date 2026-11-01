import { TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ListinoService } from './listino.service'
import { environment } from '../../../environments/environment'
import { PrezzoListino } from './listino.model'

describe('ListinoService', () => {
  let service: ListinoService
  let http: HttpTestingController
  const api = environment.apiUrl
  const ID = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] })
    service = TestBed.inject(ListinoService)
    http = TestBed.inject(HttpTestingController)
  })
  afterEach(() => http.verify())

  describe('codici IVA', () => {
    it('list con disattivate: ?incluseDisattivate=true', () => {
      service.codiciIva.list({ incluseDisattivate: true }).subscribe()
      const req = http.expectOne(r => r.url === `${api}/codici-iva`)
      expect(req.request.method).toBe('GET')
      expect(req.request.params.get('incluseDisattivate')).toBe('true')
      req.flush([])
    })

    it('crea: POST con aliquota stringa', () => {
      service.codiciIva
        .crea({ codice: '22', descrizione: 'Ordinaria', aliquota: '22.00', natura: null })
        .subscribe()
      const req = http.expectOne(`${api}/codici-iva`)
      expect(req.request.method).toBe('POST')
      expect(req.request.body.aliquota).toBe('22.00')
      req.flush({})
    })

    it('modifica: PATCH con la versione; elimina: DELETE ?versione=', () => {
      service.codiciIva.modifica(ID, { attivo: false, versione: 3 }).subscribe()
      const patch = http.expectOne(`${api}/codici-iva/${ID}`)
      expect(patch.request.method).toBe('PATCH')
      expect(patch.request.body).toEqual({ attivo: false, versione: 3 })
      patch.flush({})
      service.codiciIva.elimina(ID, 3).subscribe()
      const del = http.expectOne(r => r.url === `${api}/codici-iva/${ID}`)
      expect(del.request.method).toBe('DELETE')
      expect(del.request.params.get('versione')).toBe('3')
      del.flush(null)
    })
  })

  describe('codifiche di addebito', () => {
    it('list: ?genere= obbligatorio, disattivate a richiesta', () => {
      service.codifiche.list('CENTRO_RICAVO', true).subscribe()
      const req = http.expectOne(r => r.url === `${api}/codifiche-addebito`)
      expect(req.request.params.get('genere')).toBe('CENTRO_RICAVO')
      expect(req.request.params.get('incluseDisattivate')).toBe('true')
      req.flush([])
    })

    it('prossimoCodice: GET prossimo-codice?genere= e restituisce il codice', () => {
      let codice = ''
      service.codifiche.prossimoCodice('GRUPPO').subscribe(c => (codice = c))
      const req = http.expectOne(r => r.url === `${api}/codifiche-addebito/prossimo-codice`)
      expect(req.request.params.get('genere')).toBe('GRUPPO')
      req.flush({ codice: '004' })
      expect(codice).toBe('004')
    })

    it('crea senza codice (aggiunta in linea), modifica ed elimina', () => {
      service.codifiche.crea({ genere: 'CATEGORIA', descrizione: 'Rifiuti' }).subscribe()
      const post = http.expectOne(`${api}/codifiche-addebito`)
      expect(post.request.body).toEqual({ genere: 'CATEGORIA', descrizione: 'Rifiuti' })
      post.flush({})
      service.codifiche.modifica(ID, { descrizione: 'X', versione: 2 }).subscribe()
      http.expectOne(`${api}/codifiche-addebito/${ID}`).flush({})
      service.codifiche.elimina(ID, 2).subscribe()
      const del = http.expectOne(r => r.url === `${api}/codifiche-addebito/${ID}`)
      expect(del.request.params.get('versione')).toBe('2')
      del.flush(null)
    })
  })

  describe('archivio addebiti', () => {
    it('list: pagina e filtri come parametri, senza i valori vuoti', () => {
      service.addebiti
        .list({ testo: 'disc', tipo: '', soloAttivi: true, pagina: 2, dimensione: 25 })
        .subscribe()
      const req = http.expectOne(r => r.url === `${api}/addebiti`)
      expect(req.request.params.get('testo')).toBe('disc')
      expect(req.request.params.get('soloAttivi')).toBe('true')
      expect(req.request.params.get('pagina')).toBe('2')
      expect(req.request.params.get('dimensione')).toBe('25')
      expect(req.request.params.has('tipo')).toBeFalse()
      req.flush({ elementi: [], totale: 0 })
    })

    it('prossimoCodice, get, crea con prezzi stringa, modifica, elimina', () => {
      let codice = ''
      service.addebiti.prossimoCodice().subscribe(c => (codice = c))
      http.expectOne(`${api}/addebiti/prossimo-codice`).flush({ codice: '00001' })
      expect(codice).toBe('00001')

      service.addebiti.get(ID).subscribe()
      http.expectOne(`${api}/addebiti/${ID}`).flush({})

      const listini: PrezzoListino[] = [
        { numero: 1, prezzo: '0.0125', sconto: '10+5', provvigione: null },
      ]
      service.addebiti
        .crea({
          descrizione: 'Trasporto',
          gruppoId: ID,
          unitaMisura: 'KG',
          tipo: 'V',
          tipoProvvigione: 'SCONTATO',
          listini,
        })
        .subscribe()
      const post = http.expectOne(`${api}/addebiti`)
      expect(post.request.method).toBe('POST')
      expect(post.request.body.listini[0].prezzo).toBe('0.0125')
      post.flush({})

      service.addebiti.modifica(ID, { descrizione: 'Y', versione: 4 }).subscribe()
      const patch = http.expectOne(`${api}/addebiti/${ID}`)
      expect(patch.request.method).toBe('PATCH')
      expect(patch.request.body.versione).toBe(4)
      patch.flush({})

      service.addebiti.elimina(ID, 4).subscribe()
      const del = http.expectOne(r => r.url === `${api}/addebiti/${ID}`)
      expect(del.request.params.get('versione')).toBe('4')
      del.flush(null)
    })

    it('variazione dei prezzi: anteprima e applicazione con impronta', () => {
      const corpo = {
        tipo: 'AUMENTO_PERCENTUALE' as const,
        valore: '3.5',
        filtri: { listini: [2 as const] },
      }
      service.addebiti.anteprimaVariazione(corpo).subscribe()
      const ant = http.expectOne(`${api}/addebiti/variazioni-prezzi/anteprima`)
      expect(ant.request.method).toBe('POST')
      expect(ant.request.body.valore).toBe('3.5')
      ant.flush({ totale: 0, righe: [], errori: [], impronta: 'x' })
      service.addebiti.applicaVariazione({ ...corpo, impronta: 'x' }).subscribe()
      const app = http.expectOne(`${api}/addebiti/variazioni-prezzi`)
      expect(app.request.body.impronta).toBe('x')
      app.flush({})
    })
  })
})
