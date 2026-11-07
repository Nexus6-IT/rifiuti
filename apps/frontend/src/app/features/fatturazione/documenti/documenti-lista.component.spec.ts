import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Router } from '@angular/router'
import { Observable, Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ClientiService } from '../../clienti/clienti.service'
import { TabelleFatturazioneService } from '../../clienti/tabelle-fatturazione.service'
import { documentoRiga, paginaDocumenti } from '../elaborazioni/anteprima.fixture'
import {
  AdattatoreVista,
  CHIAVE_SELEZIONE_MAPPATURE,
  DocumentoRiga,
  Pagina,
} from '../fatturazione.model'
import { FatturazioneService, FileScaricato } from '../fatturazione.service'
import {
  DIMENSIONE_RICERCA,
  DocumentiListaComponent,
  MAX_DOCUMENTI_SELEZIONABILI,
  MSG_NON_CARICATI,
  MSG_TROPPI_SELEZIONATI,
  testoSaltati,
} from './documenti-lista.component'
import { erroreBlob, svuotaPromesse } from './documenti.fixture'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

const attesa = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

const file = (saltati = 0): FileScaricato => ({
  blob: new Blob(['x']),
  nomeFile: 'doc.zip',
  saltati,
})

const TEAMSYSTEM: AdattatoreVista = {
  codice: 'TEAMSYSTEM',
  nome: 'TeamSystem',
  modalita: 'FILE',
  verificato: false,
}

describe('DocumentiListaComponent', () => {
  let fixture: ComponentFixture<DocumentiListaComponent>
  let comp: DocumentiListaComponent
  let servizio: jasmine.SpyObj<FatturazioneService>
  let router: jasmine.SpyObj<Router>
  let clientiList: jasmine.Spy
  let salvati: string[]

  async function crea(
    ruolo = 'ADMIN',
    opzioni: { lista?: Observable<Pagina<DocumentoRiga>>; adattatori?: AdattatoreVista[] } = {}
  ): Promise<void> {
    servizio = jasmine.createSpyObj('FatturazioneService', ['documenti', 'esporta', 'adattatori'])
    servizio.documenti.and.returnValue(
      opzioni.lista ?? of(paginaDocumenti([documentoRiga(1), documentoRiga(2)]))
    )
    servizio.adattatori.and.returnValue(of(opzioni.adattatori ?? [TEAMSYSTEM]))
    servizio.esporta.and.returnValue(of(file()))
    router = jasmine.createSpyObj('Router', ['navigate'])
    clientiList = jasmine.createSpy('list').and.returnValue(of({ elementi: [], totale: 0 }))
    await TestBed.configureTestingModule({
      imports: [DocumentiListaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: servizio },
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: ClientiService, useValue: { clienti: { list: clientiList } } },
        {
          provide: TabelleFatturazioneService,
          useValue: { registri: { list: () => of([{ id: 'r1', codice: 'A' }]) } },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(DocumentiListaComponent)
    comp = fixture.componentInstance
    salvati = []
    comp.salva = (_f, nome) => void salvati.push(nome)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => {
    try {
      sessionStorage.removeItem(CHIAVE_SELEZIONE_MAPPATURE)
    } catch {
      /* niente */
    }
  })

  describe('filtri e letture', () => {
    it('la prima lettura chiede la pagina 1 con al più 100 righe', async () => {
      await crea()
      const p = servizio.documenti.calls.mostRecent().args[0]!
      expect(p.pagina).toBe(1)
      expect(p.dimensione).toBeLessThanOrEqual(100)
    })

    it('registro, anno, stato, cliente e date arrivano al servizio e tornano a pagina 1', async () => {
      await crea()
      comp.pagina.set(3)
      comp.cambia('registroIvaId', 'r1')
      comp.cambia('anno', 2026)
      comp.cambia('stato', 'DEFINITIVO')
      comp.cambia('clienteId', 'c9')
      comp.cambia('dataDa', new Date(2026, 0, 5))
      comp.cambia('dataA', new Date(2026, 10, 3))
      const p = servizio.documenti.calls.mostRecent().args[0]!
      expect(p).toEqual(
        jasmine.objectContaining({
          pagina: 1,
          registroIvaId: 'r1',
          anno: 2026,
          stato: 'DEFINITIVO',
          clienteId: 'c9',
          dataDa: '2026-01-05',
          dataA: '2026-11-03',
        })
      )
    })

    it('togliendo un filtro il parametro sparisce', async () => {
      await crea()
      comp.cambia('stato', 'ANNULLATO')
      comp.cambia('stato', null)
      expect(servizio.documenti.calls.mostRecent().args[0]!.stato).toBeUndefined()
    })

    it('periodo rovesciato: messaggio e nessuna nuova lettura', async () => {
      await crea()
      const prima = servizio.documenti.calls.count()
      comp.cambia('dataDa', new Date(2026, 5, 10))
      comp.cambia('dataA', new Date(2026, 5, 1))
      fixture.detectChanges()
      expect(q('dl-periodo')).not.toBeNull()
      expect(servizio.documenti.calls.count()).toBe(prima + 1)
    })

    it('risposta tardiva: la lettura nuova annulla la pendente', async () => {
      const lenta = new Subject<Pagina<DocumentoRiga>>()
      await crea('ADMIN', { lista: lenta })
      servizio.documenti.and.returnValue(of(paginaDocumenti([documentoRiga(7)])))
      comp.cambia('stato', 'ANNULLATO')
      expect(comp.righe().map(r => r.id)).toEqual(['d7'])
      lenta.next(paginaDocumenti([documentoRiga(1)]))
      expect(comp.righe().map(r => r.id)).toEqual(['d7'])
    })

    it('errore di lettura: messaggio fisso, senza testo del backend', async () => {
      await crea('ADMIN', {
        lista: throwError(() => ({
          status: 500,
          error: { message: 'select * from documenti 123' },
        })),
      })
      fixture.detectChanges()
      expect(q('dl-errore')?.textContent).toContain(MSG_NON_CARICATI)
      expect(q('dl-errore')?.textContent).not.toContain('select')
    })

    it('ricerca del cliente lato server con 25 risultati', async () => {
      await crea()
      clientiList.calls.reset()
      comp.cercaClienti('ros')
      await attesa(350)
      expect(clientiList).toHaveBeenCalledWith({ testo: 'ros', dimensione: DIMENSIONE_RICERCA })
      expect(DIMENSIONE_RICERCA).toBe(25)
    })

    it('ricerca cliente: una risposta tardiva non copre la nuova', async () => {
      await crea()
      const lenta = new Subject<unknown>()
      const veloce = of({
        elementi: [{ id: 'c2', codice: null, ditta: { ragioneSociale: 'Bianchi' } }],
        totale: 1,
      })
      clientiList.and.returnValues(lenta, veloce)
      comp.cercaClienti('a')
      await attesa(350)
      comp.cercaClienti('ab')
      await attesa(350)
      lenta.next({
        elementi: [{ id: 'c1', codice: null, ditta: { ragioneSociale: 'Vecchio' } }],
        totale: 1,
      })
      expect(comp.opzioniClienti().map(o => o.label)).toEqual(['Bianchi'])
    })

    it('la data annullata è barrata e ha l’etichetta di stato', async () => {
      await crea('ADMIN', {
        lista: of(paginaDocumenti([documentoRiga(1, { stato: 'ANNULLATO', numeroTesto: '9/A' })])),
      })
      const data = q('dl-data') as HTMLElement
      expect(data.classList.contains('dl-annullato')).toBeTrue()
      expect(q('dl-stato')?.textContent).toContain('Annullato')
    })
  })

  describe('selezione ed export CSV', () => {
    it('senza selezione né filtri l’export non parte', async () => {
      await crea()
      expect(comp.selezioneExport()).toBeNull()
      comp.esportaCsv()
      expect(servizio.esporta).not.toHaveBeenCalled()
      expect(q('dl-serve-selezione')).not.toBeNull()
    })

    it('con i filtri esporta per filtro', async () => {
      await crea()
      comp.cambia('registroIvaId', 'r1')
      comp.cambia('anno', 2026)
      comp.esportaCsv()
      expect(servizio.esporta).toHaveBeenCalledWith(
        'CSV',
        { registroIvaId: 'r1', anno: 2026 },
        false
      )
    })

    it('con documenti scelti esporta per id, senza conferma di emissione', async () => {
      await crea('VIEWER')
      comp.seleziona('d1', true)
      comp.seleziona('d2', true)
      comp.esportaCsv()
      expect(servizio.esporta).toHaveBeenCalledWith('CSV', { documentoIds: ['d1', 'd2'] }, false)
      expect(salvati).toEqual(['documenti.zip'])
    })

    it('«seleziona la pagina» sceglie e toglie tutte le righe', async () => {
      await crea()
      comp.selezionaPagina(true)
      expect(comp.selezione().size).toBe(2)
      expect(comp.paginaSelezionata()).toBeTrue()
      comp.selezionaPagina(false)
      expect(comp.selezione().size).toBe(0)
    })

    it('oltre 2000 documenti la selezione si ferma con un messaggio', async () => {
      await crea()
      const molti = Array.from({ length: MAX_DOCUMENTI_SELEZIONABILI + 5 }, (_, i) => `x${i}`)
      ;(comp as unknown as { imposta(ids: string[], si: boolean): void }).imposta(molti, true)
      fixture.detectChanges()
      expect(comp.selezione().size).toBe(MAX_DOCUMENTI_SELEZIONABILI)
      expect(q('dl-troppi')?.textContent).toContain(MSG_TROPPI_SELEZIONATI)
    })

    it('doppio clic su «Esporta»: una sola richiesta', async () => {
      await crea()
      servizio.esporta.and.returnValue(new Subject<FileScaricato>())
      comp.seleziona('d1', true)
      comp.esportaCsv()
      comp.esportaCsv()
      expect(servizio.esporta).toHaveBeenCalledTimes(1)
    })

    it('cambiando filtro la selezione si azzera', async () => {
      await crea()
      comp.seleziona('d1', true)
      comp.cambia('anno', 2025)
      expect(comp.selezione().size).toBe(0)
    })
  })

  describe('stato e selezione dell’export', () => {
    it('con un filtro di stato l’export per filtro è disattivato, con il messaggio', async () => {
      await crea()
      comp.cambia('registroIvaId', 'r1')
      comp.cambia('stato', 'ANNULLATO')
      fixture.detectChanges()
      expect(comp.selezioneExport()).toBeNull()
      comp.esportaCsv()
      expect(servizio.esporta).not.toHaveBeenCalled()
      expect(q('dl-serve-selezione')?.textContent).toContain(
        'Seleziona i documenti oppure togli il filtro di stato'
      )
    })

    it('con lo stato attivo ma documenti scelti si esporta per id', async () => {
      await crea()
      comp.cambia('stato', 'ANNULLATO')
      comp.seleziona('d1', true)
      comp.esportaCsv()
      expect(servizio.esporta).toHaveBeenCalledWith('CSV', { documentoIds: ['d1'] }, false)
    })

    it('«Completa le mappature» salva la selezione dell’export respinto, non una successiva', async () => {
      await crea()
      servizio.esporta.and.returnValue(
        throwError(() =>
          erroreBlob(409, {
            error: 'MAPPATURE_MANCANTI',
            details: {
              mancanti: [{ tipo: 'CODICE_IVA', chiaveWasteflow: '22', etichetta: 'IVA 22%' }],
            },
          })
        )
      )
      comp.seleziona('d1', true)
      comp.chiediEsportazione('TEAMSYSTEM', 'TeamSystem', false)
      comp.confermaEsportazione()
      await svuotaPromesse()
      comp.seleziona('d2', true)
      comp.vaiAlleMappature()
      expect(JSON.parse(sessionStorage.getItem(CHIAVE_SELEZIONE_MAPPATURE) ?? 'null')).toEqual({
        documentoIds: ['d1'],
      })
    })

    it('cambiando filtro spariscono riquadro delle mappature, esito e saltati', async () => {
      await crea()
      servizio.esporta.and.returnValue(throwError(() => erroreBlob(500, {})))
      comp.seleziona('d1', true)
      comp.esportaCsv()
      await svuotaPromesse()
      expect(comp.esito()).not.toBeNull()
      comp.cambia('anno', 2025)
      expect(comp.esito()).toBeNull()
      expect(comp.mancanti()).toBeNull()
    })
  })

  describe('ruolo insufficiente: nessuna chiamata HTTP dai metodi', () => {
    for (const ruolo of ['VIEWER', 'OPERATOR']) {
      it(`${ruolo}`, async () => {
        await crea(ruolo)
        comp.seleziona('d1', true)
        comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
        comp.inAttesa.set({ formato: 'XML_ZIP', nome: 'XML (zip)', verificato: true })
        comp.confermaEsportazione()
        ;(comp as unknown as { esporta(f: string, c: boolean): void }).esporta('TEAMSYSTEM', true)
        expect(servizio.esporta).not.toHaveBeenCalled()
      })
    }
  })

  describe('permessi', () => {
    for (const ruolo of ['VIEWER', 'OPERATOR']) {
      it(`${ruolo}: solo CSV, nessun XML né gestionale (e il gestionale non viene nemmeno caricato)`, async () => {
        await crea(ruolo)
        expect(q('dl-esporta-csv')).not.toBeNull()
        expect(q('dl-esporta-xml')).toBeNull()
        expect(q('dl-esporta-TEAMSYSTEM')).toBeNull()
        expect(servizio.adattatori).not.toHaveBeenCalled()
        comp.seleziona('d1', true)
        comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
        expect(comp.inAttesa()).toBeNull()
      })
    }

    it('ADMIN: CSV, XML e un pulsante per ogni gestionale a file', async () => {
      await crea('ADMIN', {
        adattatori: [TEAMSYSTEM, { ...TEAMSYSTEM, codice: 'ALTRO', modalita: 'API' }],
      })
      expect(q('dl-esporta-xml')).not.toBeNull()
      expect(q('dl-esporta-TEAMSYSTEM')).not.toBeNull()
      expect(q('dl-esporta-ALTRO')).toBeNull()
    })
  })

  describe('XML e gestionali con conferma', () => {
    it('XML zip: prima la conferma, poi l’export con confermaEmissione', async () => {
      await crea()
      comp.seleziona('d1', true)
      comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
      fixture.detectChanges()
      expect(servizio.esporta).not.toHaveBeenCalled()
      expect(comp.inAttesa()?.formato).toBe('XML_ZIP')
      expect(q('conferma-emissione-testo')).not.toBeNull()
      expect(q('conferma-emissione-avviso')).toBeNull()
      comp.confermaEsportazione()
      expect(servizio.esporta).toHaveBeenCalledWith('XML_ZIP', { documentoIds: ['d1'] }, true)
      expect(salvati).toEqual(['documenti-xml.zip'])
    })

    it('TeamSystem non verificato: la conferma lo dice', async () => {
      await crea()
      comp.seleziona('d1', true)
      comp.chiediEsportazione(TEAMSYSTEM.codice, TEAMSYSTEM.nome, TEAMSYSTEM.verificato)
      fixture.detectChanges()
      expect(q('conferma-emissione-avviso')?.textContent).toContain(
        "Tracciato non verificato su un'installazione reale"
      )
      comp.confermaEsportazione()
      expect(servizio.esporta).toHaveBeenCalledWith('TEAMSYSTEM', { documentoIds: ['d1'] }, true)
    })

    it('gestionale verificato: nessun avviso sul tracciato', async () => {
      await crea()
      comp.seleziona('d1', true)
      comp.chiediEsportazione('ALTRO', 'Altro', true)
      fixture.detectChanges()
      expect(q('conferma-emissione-avviso')).toBeNull()
    })

    it('«Annulla» nella conferma non esporta', async () => {
      await crea()
      comp.seleziona('d1', true)
      comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
      comp.inAttesa.set(null)
      expect(servizio.esporta).not.toHaveBeenCalled()
    })

    it('dopo un export con conferma la lista si rilegge', async () => {
      await crea()
      comp.seleziona('d1', true)
      const prima = servizio.documenti.calls.count()
      comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
      comp.confermaEsportazione()
      expect(servizio.documenti.calls.count()).toBe(prima + 1)
    })

    it('documenti annullati lasciati fuori: «N documenti annullati non inclusi»', async () => {
      await crea()
      servizio.esporta.and.returnValue(of(file(3)))
      comp.seleziona('d1', true)
      comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
      comp.confermaEsportazione()
      fixture.detectChanges()
      expect(q('dl-saltati')?.textContent).toContain('3 documenti annullati non inclusi')
      expect(testoSaltati(1)).toBe('1 documento annullato non incluso')
    })

    it('nessun saltato: nessun messaggio', async () => {
      await crea()
      comp.seleziona('d1', true)
      comp.esportaCsv()
      fixture.detectChanges()
      expect(q('dl-saltati')).toBeNull()
    })
  })

  describe('errori dell’export', () => {
    const mancanti = {
      error: 'MAPPATURE_MANCANTI',
      message: 'x',
      details: {
        mancanti: [
          { tipo: 'CODICE_IVA', chiaveWasteflow: '22.00', etichetta: 'IVA 22%' },
          { tipo: 'CLIENTE', chiaveWasteflow: 'uuid-cliente-segreto' },
        ],
      },
    }

    it('409 MAPPATURE_MANCANTI: elenco delle chiavi con le etichette, senza id', async () => {
      await crea()
      servizio.esporta.and.returnValue(throwError(() => erroreBlob(409, mancanti)))
      comp.seleziona('d1', true)
      comp.chiediEsportazione(TEAMSYSTEM.codice, TEAMSYSTEM.nome, false)
      comp.confermaEsportazione()
      await svuotaPromesse()
      fixture.detectChanges()
      const voci = Array.from(document.body.querySelectorAll('[data-testid="dl-mancante"]')).map(
        e => e.textContent?.replace(/\s+/g, ' ').trim()
      )
      expect(voci).toEqual(['Codice IVA: IVA 22%', 'Cliente'])
      expect(q('dl-mancanti')?.textContent).not.toContain('uuid-cliente-segreto')
      expect(q('dl-completa-mappature')).not.toBeNull()
    })

    it('«Completa le mappature»: salva la selezione e naviga con lo stato', async () => {
      await crea()
      servizio.esporta.and.returnValue(throwError(() => erroreBlob(409, mancanti)))
      comp.seleziona('d1', true)
      comp.chiediEsportazione(TEAMSYSTEM.codice, TEAMSYSTEM.nome, false)
      comp.confermaEsportazione()
      await svuotaPromesse()
      comp.vaiAlleMappature()
      expect(JSON.parse(sessionStorage.getItem(CHIAVE_SELEZIONE_MAPPATURE) ?? 'null')).toEqual({
        documentoIds: ['d1'],
      })
      expect(router.navigate).toHaveBeenCalledWith(
        ['/fatturazione', 'export-contabile', 'TEAMSYSTEM'],
        {
          state: {
            mancanti: [{ tipo: 'CODICE_IVA', chiaveWasteflow: '22.00', etichetta: 'IVA 22%' }],
          },
        }
      )
    })

    it('sessionStorage che lancia: naviga lo stesso', async () => {
      await crea()
      servizio.esporta.and.returnValue(throwError(() => erroreBlob(409, mancanti)))
      comp.seleziona('d1', true)
      comp.chiediEsportazione(TEAMSYSTEM.codice, TEAMSYSTEM.nome, false)
      comp.confermaEsportazione()
      await svuotaPromesse()
      spyOn(Storage.prototype, 'setItem').and.throwError('quota')
      expect(() => comp.vaiAlleMappature()).not.toThrow()
      expect(router.navigate).toHaveBeenCalled()
    })

    it('422 XML_NON_VALIDO senza posizione né dati: messaggio fisso', async () => {
      await crea()
      servizio.esporta.and.returnValue(throwError(() => erroreBlob(422, {})))
      comp.seleziona('d1', true)
      comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
      comp.confermaEsportazione()
      await svuotaPromesse()
      fixture.detectChanges()
      expect(q('dl-esito')?.textContent).toContain("L'XML generato non è valido")
    })

    it('422 XML_NON_VALIDO con dati nel corpo: si mostra solo l’etichetta del codice', async () => {
      await crea()
      servizio.esporta.and.returnValue(
        throwError(() =>
          erroreBlob(422, {
            error: 'XML_NON_VALIDO',
            message: 'Rossi Mario 15/A riga 3 non valida',
            details: { numero: '15/A' },
          })
        )
      )
      comp.seleziona('d1', true)
      comp.chiediEsportazione('XML_ZIP', 'XML (zip)', true)
      comp.confermaEsportazione()
      await svuotaPromesse()
      fixture.detectChanges()
      expect(q('dl-esito')?.textContent).not.toContain('Rossi')
      expect(q('dl-esito')?.textContent).not.toContain('15/A')
    })

    it('TROPPI_DOCUMENTI: messaggio dal vocabolario', async () => {
      await crea()
      servizio.esporta.and.returnValue(
        throwError(() => erroreBlob(400, { error: 'TROPPI_DOCUMENTI', message: 'max 500' }))
      )
      comp.seleziona('d1', true)
      comp.esportaCsv()
      await svuotaPromesse()
      fixture.detectChanges()
      expect(q('dl-esito')?.textContent).toContain('troppi documenti')
    })

    it('dopo l’errore si può riprovare (nessun blocco)', async () => {
      await crea()
      servizio.esporta.and.returnValues(
        throwError(() => erroreBlob(500, {})),
        of(file())
      )
      comp.seleziona('d1', true)
      comp.esportaCsv()
      await svuotaPromesse()
      comp.esportaCsv()
      expect(servizio.esporta).toHaveBeenCalledTimes(2)
    })
  })

  describe('navigazione', () => {
    it('«Apri» va al dettaglio', async () => {
      await crea()
      comp.apri(documentoRiga(1))
      expect(router.navigate).toHaveBeenCalledWith(['/fatturazione', 'documenti', 'd1'])
    })
  })
})
