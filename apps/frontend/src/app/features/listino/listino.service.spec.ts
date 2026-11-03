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
      del.flush({ avvisi: [] })
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
      del.flush({ avvisi: [] })
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
      del.flush({ avvisi: [] })
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
      let aggiornati = -1
      service.addebiti
        .applicaVariazione({ ...corpo, impronta: 'x' })
        .subscribe(esito => (aggiornati = esito.aggiornati))
      const app = http.expectOne(`${api}/addebiti/variazioni-prezzi`)
      expect(app.request.body.impronta).toBe('x')
      app.flush({ aggiornati: 7 })
      expect(aggiornati).toBe(7)
    })
  })

  describe('elenchi del contratto (Task 20)', () => {
    it('delContratto: GET annidato; prossimoCodice estrae il codice', () => {
      service.elenchi.delContratto(ID).subscribe()
      http.expectOne(`${api}/contratti-clienti/${ID}/elenchi`).flush({ contesto: {}, elenchi: [] })
      let codice = ''
      service.elenchi.prossimoCodice(ID).subscribe(c => (codice = c))
      http
        .expectOne(`${api}/contratti-clienti/${ID}/elenchi/prossimo-codice`)
        .flush({ codice: '002' })
      expect(codice).toBe('002')
    })

    it("crea sul contratto; modifica con versione e elimina con ?versione= sull'elenco", () => {
      service.elenchi.crea(ID, { descrizione: 'Principale', predefinito: true }).subscribe()
      const post = http.expectOne(`${api}/contratti-clienti/${ID}/elenchi`)
      expect(post.request.method).toBe('POST')
      expect(post.request.body.predefinito).toBeTrue()
      post.flush({})
      service.elenchi.modifica(ID, { descrizione: 'X', versione: 2 }).subscribe()
      const patch = http.expectOne(`${api}/elenchi-addebiti/${ID}`)
      expect(patch.request.method).toBe('PATCH')
      expect(patch.request.body).toEqual({ descrizione: 'X', versione: 2 })
      patch.flush({})
      service.elenchi.elimina(ID, 2).subscribe()
      const del = http.expectOne(r => r.url === `${api}/elenchi-addebiti/${ID}`)
      expect(del.request.method).toBe('DELETE')
      expect(del.request.params.get('versione')).toBe('2')
      del.flush({ avvisi: [] })
    })
  })

  describe('righe (Task 21)', () => {
    it("list e crea sull'elenco; modifica ed elimina sulla riga", () => {
      service.righe.list(ID).subscribe()
      http.expectOne(`${api}/elenchi-addebiti/${ID}/righe`).flush([])
      service.righe.crea(ID, { tipo: 'V', prezzo: '1.5' }).subscribe()
      const post = http.expectOne(`${api}/elenchi-addebiti/${ID}/righe`)
      expect(post.request.method).toBe('POST')
      expect(post.request.body.prezzo).toBe('1.5')
      post.flush({})
      service.righe.modifica(ID, { prezzo: '2', versione: 4 }).subscribe()
      const patch = http.expectOne(`${api}/righe-addebito/${ID}`)
      expect(patch.request.method).toBe('PATCH')
      expect(patch.request.body.versione).toBe(4)
      patch.flush({})
      service.righe.elimina(ID, 4).subscribe()
      const del = http.expectOne(r => r.url === `${api}/righe-addebito/${ID}`)
      expect(del.request.params.get('versione')).toBe('4')
      del.flush({ avvisi: [] })
    })

    it('proposta: ?addebitoId= oppure ?cerCode=, mai i parametri vuoti', () => {
      service.righe.proposta(ID, { cerCode: '20 03 01' }).subscribe()
      const r = http.expectOne(r => r.url === `${api}/contratti-clienti/${ID}/righe-proposta`)
      expect(r.request.params.get('cerCode')).toBe('20 03 01')
      expect(r.request.params.has('addebitoId')).toBeFalse()
      r.flush({})
    })

    it('codificheRentri: ?tabella=', () => {
      service.righe.codificheRentri('stati-fisici').subscribe()
      const r = http.expectOne(r => r.url === `${api}/righe-addebito/codifiche-rentri`)
      expect(r.request.params.get('tabella')).toBe('stati-fisici')
      r.flush([])
    })
  })

  describe('azioni sul listino (Task 23, R45)', () => {
    it('sostituisciDa e aggiungiRighe: corpo con versione; esito con le escluse', () => {
      let esito: unknown
      service.azioni.sostituisciDa(ID, 'altro', 3).subscribe(e => (esito = e))
      const a = http.expectOne(`${api}/elenchi-addebiti/${ID}/sostituisci-da`)
      expect(a.request.body).toEqual({ daElencoId: 'altro', versione: 3 })
      const atteso = {
        copiate: 4,
        escluse: { minimi: 1, acconti: 0, conguagli: 0, duplicate: 2, condizioni: 1 },
      }
      a.flush(atteso)
      expect(esito).toEqual(atteso)
      service.azioni.aggiungiRighe(ID, ['r1', 'r2'], 3).subscribe()
      const b = http.expectOne(`${api}/elenchi-addebiti/${ID}/aggiungi-righe`)
      expect(b.request.body).toEqual({ righeIds: ['r1', 'r2'], versione: 3 })
      b.flush({})
    })

    it('provvigioni (anche null per svuotare) e sconti sul contratto', () => {
      service.azioni.provvigioni(ID, { provvigione: null, tipoProvvigione: null }).subscribe()
      const p = http.expectOne(`${api}/contratti-clienti/${ID}/provvigioni`)
      expect(p.request.body).toEqual({ provvigione: null, tipoProvvigione: null })
      p.flush({ aggiornate: 1, speciali: 0, escluse: 0 })
      service.azioni.sconti(ID, { scontoAttuale: '10+5', scontoNuovo: '12' }).subscribe()
      const s = http.expectOne(`${api}/contratti-clienti/${ID}/sconti`)
      expect(s.request.body).toEqual({ scontoAttuale: '10+5', scontoNuovo: '12' })
      s.flush({})
    })
  })

  describe('variazioni dei contratti e ISTAT (Task 24, R46)', () => {
    it("anteprima e applica su /variazioni-prezzi; applica porta l'impronta", () => {
      const corpo = {
        tipo: 'AUMENTO_PERCENTUALE' as const,
        valore: '3',
        soloMinimi: true,
        filtri: { contrattiIds: ['c1'] },
      }
      service.variazioniContratti.anteprima(corpo).subscribe()
      const ant = http.expectOne(`${api}/variazioni-prezzi/anteprima`)
      expect(ant.request.body.filtri.contrattiIds).toEqual(['c1'])
      ant.flush({ totale: 0, righe: [], errori: [], impronta: 'x' })
      service.variazioniContratti.applica({ ...corpo, impronta: 'x' }).subscribe()
      const app = http.expectOne(`${api}/variazioni-prezzi`)
      expect(app.request.body.impronta).toBe('x')
      app.flush({ aggiornati: 2 })
    })

    it('ISTAT: mesi con ?ancheAnnoPrecedente=, anteprima e applicazione', () => {
      service.variazioniContratti.mesiIstat(true).subscribe()
      const m = http.expectOne(r => r.url === `${api}/variazioni-prezzi/istat/mesi`)
      expect(m.request.params.get('ancheAnnoPrecedente')).toBe('true')
      m.flush([{ anno: 2024, mese: 1, contratti: 3 }])
      service.variazioniContratti.mesiIstat().subscribe()
      const senza = http.expectOne(r => r.url === `${api}/variazioni-prezzi/istat/mesi`)
      expect(senza.request.params.has('ancheAnnoPrecedente')).toBeFalse()
      senza.flush([])
      const corpo = { percentuali: [{ anno: 2024, mese: 1, percentuale: '3.0' }], tipi: ['V'] }
      service.variazioniContratti.anteprimaIstat(corpo).subscribe()
      http
        .expectOne(`${api}/variazioni-prezzi/istat/anteprima`)
        .flush({ totale: 0, righe: [], errori: [], impronta: 'y' })
      service.variazioniContratti.applicaIstat({ ...corpo, impronta: 'y' }).subscribe()
      const app = http.expectOne(`${api}/variazioni-prezzi/istat`)
      expect(app.request.body.impronta).toBe('y')
      app.flush({ aggiornati: 1 })
    })
  })

  describe("allegati dell'elenco (Task 25)", () => {
    it('stessa forma di quelli del contratto, sotto /elenchi-addebiti', () => {
      service.allegatiElenco.elenco(ID).subscribe()
      http.expectOne(`${api}/elenchi-addebiti/${ID}/allegati`).flush([])
      service.allegatiElenco.rimuovi(ID, 'a1').subscribe()
      const del = http.expectOne(`${api}/elenchi-addebiti/${ID}/allegati/a1`)
      expect(del.request.method).toBe('DELETE')
      del.flush({ avvisi: [] })
      service.allegatiElenco.carica(ID, 2, new File(['%PDF'], 'a.pdf')).subscribe()
      const post = http.expectOne(`${api}/elenchi-addebiti/${ID}/allegati`)
      expect((post.request.body as FormData).get('posizione')).toBe('2')
      post.flush({})
    })
  })
})
