import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { MessageService } from 'primeng/api'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import {
  Cliente,
  CodificaContratto,
  ContrattoCliente,
  Pagina,
  StatoContrattoCliente,
} from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { LegamiService } from '../legami/legami.service'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import {
  accettaConferma,
  bottone,
  q,
  scrivi,
  stabilizza,
} from '../clienti/tabelle/tabelle-test-utils'
import { AnnulloDialogComponent } from './annullo-dialog.component'
import { ContrattoClienteDialogComponent } from './contratto-cliente-dialog.component'
import { ContrattiClienteListComponent } from './contratti-cliente-list.component'
import { IstatDialogComponent } from '../listino/istat-dialog.component'
import { VariazionePrezziDialogComponent } from '../listino/variazione-prezzi-dialog.component'
import { ProrogaDialogComponent } from './proroga-dialog.component'

/** Il dialog vero (di Task 26) carica le tabelle all'apertura: qui basta la sua interfaccia. */
@Component({ selector: 'app-contratto-cliente-dialog', standalone: true, template: '' })
class ContrattoDialogFinto {
  @Input() visible = false
  @Input() contratto: ContrattoCliente | null = null
  @Output() salvato = new EventEmitter<ContrattoCliente>()
  @Output() visibleChange = new EventEmitter<boolean>()
}

@Component({ selector: 'app-variazione-prezzi-dialog', standalone: true, template: '' })
class VariazioneDialogFinta {
  @Input() visible = false
  @Input() contrattiIds: string[] | null = null
  @Output() applicata = new EventEmitter<number>()
  @Output() visibleChange = new EventEmitter<boolean>()
}

@Component({ selector: 'app-istat-dialog', standalone: true, template: '' })
class IstatDialogFinto {
  @Input() visible = false
  @Output() applicata = new EventEmitter<number>()
  @Output() visibleChange = new EventEmitter<boolean>()
}

const contratto = (over: Partial<ContrattoCliente> = {}): ContrattoCliente =>
  ({
    id: 'cc1',
    numero: 'CC-2026-001',
    descrizione: 'Ritiro rifiuti speciali',
    stato: 'ATTIVO',
    versione: 3,
    dataInizio: '2026-01-15',
    dataFine: '2026-12-31',
    cliente: {
      id: 'cl1',
      ragioneSociale: 'Verdi Servizi S.r.l.',
      partitaIva: '12345678903',
      attivo: true,
    },
    categoria: { id: 'cat1', codice: '001', descrizione: 'Smaltimento' },
    scaduto: false,
    prossimaFinePeriodo: '2026-03-31',
    transizioni: ['SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
    eliminabile: false,
    rinnovabile: true,
    ...over,
  }) as ContrattoCliente

const pagina = (...e: ContrattoCliente[]): Pagina<ContrattoCliente> => ({
  elementi: e,
  totale: e.length,
})

const codifica = (
  id: string,
  genere: 'CATEGORIA' | 'TIPO',
  descrizione: string
): CodificaContratto => ({
  id,
  versione: 1,
  eliminabile: true,
  genere,
  codice: '001',
  descrizione,
  attiva: true,
})

describe('ContrattiClienteListComponent', () => {
  let fixture: ComponentFixture<ContrattiClienteListComponent>
  let list: jasmine.Spy
  let listaLegami: jasmine.Spy
  let get: jasmine.Spy
  let cambiaStato: jasmine.Spy
  let rinnova: jasmine.Spy
  let elimina: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>

  async function apri(role = 'ADMIN', primo: Pagina<ContrattoCliente> = pagina(contratto())) {
    list.and.returnValue(of(primo))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(ContrattiClienteListComponent)
    await stabilizza(fixture)
  }

  const figlio = <T>(tipo: new (...a: never[]) => T): T =>
    fixture.debugElement.query(By.directive(tipo)).componentInstance as T

  beforeEach(() => {
    list = jasmine.createSpy('list')
    listaLegami = jasmine
      .createSpy('contatoriPerContratto')
      .and.returnValue(of({ perContratto: [], senzaContratto: [] }))
    get = jasmine.createSpy('get')
    cambiaStato = jasmine.createSpy('cambiaStato').and.returnValue(of(contratto()))
    rinnova = jasmine.createSpy('rinnova').and.returnValue(of(contratto()))
    elimina = jasmine.createSpy('elimina').and.returnValue(of(undefined))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn'])
    const codifiche = jasmine
      .createSpy('codifiche')
      .and.callFake((genere: string) =>
        of(
          genere === 'CATEGORIA'
            ? [codifica('cat1', 'CATEGORIA', 'Smaltimento')]
            : [codifica('tip1', 'TIPO', 'Annuale')]
        )
      )
    TestBed.configureTestingModule({
      imports: [ContrattiClienteListComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: ClientiService,
          useValue: {
            contratti: { list, get, cambiaStato, rinnova, elimina },
            clienti: { list: () => of({ elementi: [], totale: 0 }) },
          },
        },
        { provide: LegamiService, useValue: { contatoriPerContratto: listaLegami } },
        { provide: TabelleFatturazioneService, useValue: { codifiche: { list: codifiche } } },
        { provide: ToastService, useValue: toast },
        MessageService,
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
    for (const c of [AnnulloDialogComponent, ProrogaDialogComponent]) {
      TestBed.overrideComponent(c, { set: { template: '' } })
    }
    TestBed.overrideComponent(ContrattiClienteListComponent, {
      remove: {
        imports: [
          ContrattoClienteDialogComponent,
          VariazionePrezziDialogComponent,
          IstatDialogComponent,
        ],
      },
      add: { imports: [ContrattoDialogFinto, VariazioneDialogFinta, IstatDialogFinto] },
    })
  })
  afterEach(() => fixture?.destroy())

  describe('contatore «da collegare»', () => {
    it('una sola chiamata per pagina con gli id dei contratti visibili, conteggio esatto per contratto', async () => {
      listaLegami.and.returnValue(
        of({ perContratto: [{ contrattoId: 'cc1', daCollegare: 3 }], senzaContratto: [] })
      )
      await apri('ADMIN', pagina(contratto(), contratto({ id: 'cc2' })))
      expect(listaLegami).toHaveBeenCalledTimes(1)
      expect(listaLegami).toHaveBeenCalledWith(['cc1', 'cc2'])
      expect(q('contratti-da-collegare-cc1')!.textContent!.trim()).toBe('3')
      expect(q('contratti-da-collegare-cc2')).toBeNull()
      expect(q('contratti-da-collegare-cc1')!.getAttribute('href')).toBe(
        '/legami/da-collegare?clienteId=cl1'
      )
    })

    it('pagina vuota: nessuna chiamata', async () => {
      await apri('ADMIN', pagina())
      expect(listaLegami).not.toHaveBeenCalled()
    })

    it('errore: la colonna resta vuota e la pagina funziona', async () => {
      listaLegami.and.returnValue(throwError(() => ({ status: 500 })))
      await apri()
      expect(q('contratti-da-collegare-cc1')).toBeNull()
      expect(q('contratti-riga-cc1')).toBeTruthy()
    })
  })

  describe('elenco', () => {
    it('titolo e colonne: numero, cliente, descrizione, categoria, stato, inizio, fine, prossima fatturazione', async () => {
      await apri()
      expect(document.body.querySelector('h1')!.textContent).toContain('Contratti clienti')
      const intest = Array.from(document.body.querySelectorAll('th')).map(t =>
        t.textContent!.trim()
      )
      expect(intest).toEqual(
        jasmine.arrayContaining([
          'Numero',
          'Cliente',
          'Descrizione',
          'Categoria',
          'Stato',
          'Inizio',
          'Fine',
          'Prossima fatturazione',
        ])
      )
    })

    it('la riga mostra i dati leggibili, date italiane, e mai gli id', async () => {
      await apri()
      const riga = q('contratti-riga-cc1')!.textContent!
      for (const t of [
        'CC-2026-001',
        'Verdi Servizi S.r.l.',
        'Ritiro rifiuti speciali',
        'Smaltimento',
        'Attivo',
        '15/01/2026',
        '31/12/2026',
        '31/03/2026',
      ]) {
        expect(riga).toContain(t)
      }
      expect(riga).not.toContain('cc1')
      expect(riga).not.toContain('cl1')
      expect(riga).not.toContain('cat1')
    })

    it('badge "Scaduto" solo se il contratto è scaduto', async () => {
      await apri(
        'ADMIN',
        pagina(contratto({ scaduto: true }), contratto({ id: 'cc2', scaduto: false }))
      )
      expect(q('contratti-riga-cc1')!.textContent).toContain('Scaduto')
      expect(q('contratti-riga-cc2')!.textContent).not.toContain('Scaduto')
    })

    it('senza data di fine né prossima fatturazione le celle sono vuote', async () => {
      // OPERATOR: senza la colonna di scelta dell'ADMIN gli indici delle celle restano questi.
      await apri('OPERATOR', pagina(contratto({ dataFine: null, prossimaFinePeriodo: null })))
      const celle = q('contratti-riga-cc1')!.querySelectorAll('td')
      expect(celle[6].textContent!.trim()).toBe('')
      expect(celle[7].textContent!.trim()).toBe('')
    })

    it('un solo caricamento iniziale, pagina 1 e dimensione 25, senza filtri', async () => {
      await apri()
      expect(list).toHaveBeenCalledOnceWith({ pagina: 1, dimensione: 25 })
    })

    it('nessun contratto: messaggio', async () => {
      await apri('ADMIN', pagina())
      expect(document.body.textContent).toContain('Nessun contratto.')
    })

    it('errore di caricamento: messaggio del backend', async () => {
      list.and.returnValue(throwError(() => ({ error: { message: 'Servizio non disponibile.' } })))
      TestBed.overrideProvider(AuthService, {
        useValue: { currentUser: () => ({ role: 'ADMIN' }) },
      })
      fixture = TestBed.createComponent(ContrattiClienteListComponent)
      await stabilizza(fixture)
      expect(document.body.textContent).toContain('Servizio non disponibile.')
    })

    it('una risposta in ritardo non sovrascrive quella attuale', async () => {
      await apri()
      const vecchia = new Subject<Pagina<ContrattoCliente>>()
      const nuova = new Subject<Pagina<ContrattoCliente>>()
      list.and.returnValues(vecchia, nuova)
      fixture.componentInstance.carica()
      fixture.componentInstance.carica()
      nuova.next(pagina(contratto({ numero: 'NUOVO' })))
      vecchia.next(pagina(contratto({ numero: 'VECCHIO' })))
      expect(fixture.componentInstance.righe().map(r => r.numero)).toEqual(['NUOVO'])
    })
  })

  describe('filtri', () => {
    it('ricerca con debounce: una sola chiamata con il testo, di nuovo a pagina 1', fakeAsync(() => {
      list.and.returnValue(of(pagina(contratto())))
      TestBed.overrideProvider(AuthService, {
        useValue: { currentUser: () => ({ role: 'ADMIN' }) },
      })
      fixture = TestBed.createComponent(ContrattiClienteListComponent)
      fixture.detectChanges()
      tick()
      list.calls.reset()
      scrivi('contratti-cerca', 've')
      scrivi('contratti-cerca', 'verdi')
      tick(100)
      expect(list).not.toHaveBeenCalled()
      tick(300)
      expect(list).toHaveBeenCalledOnceWith({ pagina: 1, dimensione: 25, testo: 'verdi' })
    }))

    it('stato, categoria, tipo e cliente viaggiano al backend e riportano a pagina 1', async () => {
      await apri()
      list.calls.reset()
      const c = fixture.componentInstance
      c.cambiaPagina({ first: 25, rows: 25 })
      list.calls.reset()
      c.filtraStato('SOSPESO')
      expect(list.calls.mostRecent().args[0]).toEqual({
        pagina: 1,
        dimensione: 25,
        stato: 'SOSPESO',
      })
      c.filtraCategoria('cat1')
      c.filtraTipo('tip1')
      c.filtraCliente({ id: 'cl7' } as Cliente)
      expect(list.calls.mostRecent().args[0]).toEqual({
        pagina: 1,
        dimensione: 25,
        stato: 'SOSPESO',
        categoriaId: 'cat1',
        tipoId: 'tip1',
        clienteId: 'cl7',
      })
    })

    it('togliere un filtro lo toglie dalla richiesta', async () => {
      await apri()
      const c = fixture.componentInstance
      c.filtraStato('ATTIVO')
      c.filtraStato(null)
      c.filtraCliente(null)
      expect(list.calls.mostRecent().args[0]).toEqual({ pagina: 1, dimensione: 25 })
    })

    it('"in scadenza entro 30 giorni" manda inScadenzaEntroGiorni 30', async () => {
      await apri()
      expect(q('contratti-filtro-scadenza')).toBeTruthy()
      fixture.componentInstance.filtraInScadenza(true)
      expect(list.calls.mostRecent().args[0]).toEqual({
        pagina: 1,
        dimensione: 25,
        inScadenzaEntroGiorni: 30,
      })
      fixture.componentInstance.filtraInScadenza(false)
      expect(list.calls.mostRecent().args[0]).toEqual({ pagina: 1, dimensione: 25 })
    })

    it('categorie e tipi per i filtri vengono dalle codifiche attive', async () => {
      await apri()
      expect(fixture.componentInstance.categorie().map(o => o.etichetta)).toEqual(['Smaltimento'])
      expect(fixture.componentInstance.tipi().map(o => o.etichetta)).toEqual(['Annuale'])
    })
  })

  describe('azioni di stato', () => {
    it('mostra solo le transizioni della vista, con le etichette giuste', async () => {
      await apri()
      expect(bottone('contratti-stato-cc1-SOSPESO')!.textContent).toContain('Sospendi')
      expect(bottone('contratti-stato-cc1-SOSPESO_MOVIMENTI')!.textContent).toContain(
        'Sospendi solo movimenti'
      )
      expect(bottone('contratti-stato-cc1-ANNULLATO')!.textContent).toContain('Annulla')
      expect(q('contratti-stato-cc1-ATTIVO')).toBeNull()
    })

    it('bozza: "Attiva"; sospeso: "Riattiva"', async () => {
      await apri(
        'ADMIN',
        pagina(
          contratto({ id: 'b', stato: 'BOZZA', transizioni: ['ATTIVO'] }),
          contratto({
            id: 's',
            stato: 'SOSPESO',
            transizioni: ['ATTIVO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
          })
        )
      )
      expect(bottone('contratti-stato-b-ATTIVO')!.textContent).toContain('Attiva')
      expect(bottone('contratti-stato-b-ATTIVO')!.textContent).not.toContain('Riattiva')
      expect(bottone('contratti-stato-s-ATTIVO')!.textContent).toContain('Riattiva')
      expect(q('contratti-stato-b-SOSPESO')).toBeNull()
    })

    it('annullato: nessuna azione di stato (non lo decide il frontend)', async () => {
      await apri(
        'ADMIN',
        pagina(contratto({ stato: 'ANNULLATO', transizioni: [], rinnovabile: false }))
      )
      for (const s of [
        'ATTIVO',
        'SOSPESO',
        'SOSPESO_MOVIMENTI',
        'ANNULLATO',
      ] as StatoContrattoCliente[]) {
        expect(q(`contratti-stato-cc1-${s}`)).toBeNull()
      }
    })

    it('Sospendi manda stato e versione e poi ricarica', async () => {
      await apri()
      list.calls.reset()
      bottone('contratti-stato-cc1-SOSPESO')!.click()
      expect(cambiaStato).toHaveBeenCalledOnceWith('cc1', { stato: 'SOSPESO', versione: 3 })
      expect(list).toHaveBeenCalledTimes(1)
    })

    it("Annulla non cambia stato da sola: apre il dialog dell'annullo col contratto", async () => {
      await apri()
      bottone('contratti-stato-cc1-ANNULLATO')!.click()
      await stabilizza(fixture)
      expect(cambiaStato).not.toHaveBeenCalled()
      const dlg = figlio(AnnulloDialogComponent)
      expect(dlg.visible).toBeTrue()
      expect(dlg.contratto?.id).toBe('cc1')
    })

    it('annullato: chiude il dialog e ricarica; fallito: toast col messaggio e ricarica', async () => {
      await apri()
      bottone('contratti-stato-cc1-ANNULLATO')!.click()
      await stabilizza(fixture)
      list.calls.reset()
      figlio(AnnulloDialogComponent).annullato.emit(contratto({ stato: 'ANNULLATO' }))
      await stabilizza(fixture)
      expect(list).toHaveBeenCalledTimes(1)
      expect(figlio(AnnulloDialogComponent).visible).toBeFalse()
      list.calls.reset()
      figlio(AnnulloDialogComponent).fallito.emit('Conflitto di versione.')
      expect(toast.error).toHaveBeenCalledWith('Conflitto di versione.')
      expect(list).toHaveBeenCalledTimes(1)
    })

    it("400 all'attivazione (condizione o registro mancanti): toast col messaggio e ricarica", async () => {
      await apri('ADMIN', pagina(contratto({ stato: 'BOZZA', transizioni: ['ATTIVO'] })))
      cambiaStato.and.returnValue(
        throwError(() => ({
          status: 400,
          error: { message: 'Per attivare il contratto indica la condizione di pagamento.' },
        }))
      )
      list.calls.reset()
      bottone('contratti-stato-cc1-ATTIVO')!.click()
      expect(toast.error).toHaveBeenCalledWith(
        'Per attivare il contratto indica la condizione di pagamento.'
      )
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('409: toast e la lista si ricarica', async () => {
      await apri()
      cambiaStato.and.returnValue(
        throwError(() => ({
          status: 409,
          error: { message: 'Dallo stato Annullato non si passa a Attivo.' },
        }))
      )
      list.calls.reset()
      bottone('contratti-stato-cc1-SOSPESO')!.click()
      expect(toast.error).toHaveBeenCalledWith('Dallo stato Annullato non si passa a Attivo.')
      expect(list).toHaveBeenCalledTimes(1)
    })
  })

  describe('rinnovo', () => {
    it("Rinnova non c'è se non rinnovabile", async () => {
      await apri('ADMIN', pagina(contratto({ rinnovabile: false })))
      expect(q('contratti-rinnova-cc1')).toBeNull()
    })

    it("Rinnova c'è se rinnovabile", async () => {
      await apri('ADMIN', pagina(contratto({ rinnovabile: true })))
      expect(q('contratti-rinnova-cc1')).toBeTruthy()
    })

    it('la conferma mostra la nuova data di fine e poi manda id e versione', async () => {
      await apri()
      bottone('contratti-rinnova-cc1')!.click()
      await stabilizza(fixture)
      expect(document.body.textContent).toContain('CC-2026-001')
      expect(document.body.textContent).toContain('31/12/2026')
      expect(document.body.textContent).toContain('31/12/2027')
      expect(rinnova).not.toHaveBeenCalled()
      list.calls.reset()
      accettaConferma()
      await stabilizza(fixture)
      expect(rinnova).toHaveBeenCalledOnceWith('cc1', 3)
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('fine al 29 febbraio: la nuova data è il 28 febbraio (non si copia il bug di WinWaste)', async () => {
      expect(ContrattiClienteListComponent.finePiuUnAnno('2028-02-29')).toBe('2029-02-28')
      expect(ContrattiClienteListComponent.finePiuUnAnno('2026-12-31')).toBe('2027-12-31')
      expect(ContrattiClienteListComponent.finePiuUnAnno('2027-02-28')).toBe('2028-02-28')
    })

    it('rinnovo con 409: toast col messaggio e ricarica', async () => {
      await apri()
      rinnova.and.returnValue(
        throwError(() => ({
          status: 409,
          error: {
            message: 'Si rinnovano solo i contratti attivi o sospesi con una data di fine.',
          },
        }))
      )
      list.calls.reset()
      fixture.componentInstance.rinnovaConfermato(contratto())
      expect(toast.error).toHaveBeenCalledWith(
        'Si rinnovano solo i contratti attivi o sospesi con una data di fine.'
      )
      expect(list).toHaveBeenCalledTimes(1)
    })
  })

  describe('eliminazione', () => {
    it("Elimina non c'è se non eliminabile", async () => {
      await apri('ADMIN', pagina(contratto({ eliminabile: false })))
      expect(q('contratti-elimina-cc1')).toBeNull()
    })

    it("Elimina c'è se eliminabile", async () => {
      await apri('ADMIN', pagina(contratto({ eliminabile: true })))
      expect(q('contratti-elimina-cc1')).toBeTruthy()
    })

    it('conferma con il numero e poi manda id e versione', async () => {
      await apri('ADMIN', pagina(contratto({ eliminabile: true })))
      bottone('contratti-elimina-cc1')!.click()
      await stabilizza(fixture)
      expect(document.body.textContent).toContain('Eliminare il contratto CC-2026-001?')
      expect(elimina).not.toHaveBeenCalled()
      accettaConferma()
      await stabilizza(fixture)
      expect(elimina).toHaveBeenCalledOnceWith('cc1', 3)
    })

    it('409: toast col messaggio e ricarica', async () => {
      await apri()
      elimina.and.returnValue(
        throwError(() => ({ status: 409, error: { message: 'Il contratto è cambiato.' } }))
      )
      list.calls.reset()
      fixture.componentInstance.eliminaConfermato(contratto())
      expect(toast.error).toHaveBeenCalledWith('Il contratto è cambiato.')
      expect(list).toHaveBeenCalledTimes(1)
    })
  })

  describe('dialog del contratto e proroga', () => {
    it('Nuovo apre il dialog senza contratto', async () => {
      await apri()
      bottone('contratti-nuovo')!.click()
      await stabilizza(fixture)
      const dlg = figlio(ContrattoDialogFinto)
      expect(dlg.visible).toBeTrue()
      expect(dlg.contratto).toBeNull()
    })

    it('Modifica rilegge il contratto e apre il dialog con la versione vera', async () => {
      await apri()
      get.and.returnValue(of(contratto({ versione: 9 })))
      bottone('contratti-modifica-cc1')!.click()
      await stabilizza(fixture)
      expect(get).toHaveBeenCalledOnceWith('cc1')
      const dlg = figlio(ContrattoDialogFinto)
      expect(dlg.visible).toBeTrue()
      expect(dlg.contratto?.versione).toBe(9)
    })

    it('Modifica con la lettura fallita: toast, ricarica e dialog chiuso', async () => {
      await apri()
      get.and.returnValue(throwError(() => ({ error: { message: 'Non trovato.' } })))
      list.calls.reset()
      fixture.componentInstance.apriModifica(contratto())
      expect(toast.error).toHaveBeenCalledWith('Non trovato.')
      expect(list).toHaveBeenCalledTimes(1)
      expect(fixture.componentInstance.dialogoAperto()).toBeFalse()
    })

    it('salvato nel dialog: ricarica', async () => {
      await apri()
      bottone('contratti-nuovo')!.click()
      await stabilizza(fixture)
      list.calls.reset()
      figlio(ContrattoDialogFinto).salvato.emit(contratto())
      expect(list).toHaveBeenCalledTimes(1)
    })

    it('Proroga scadenze apre il suo dialog; a fine proroga ricarica', async () => {
      await apri()
      bottone('contratti-proroga')!.click()
      await stabilizza(fixture)
      expect(figlio(ProrogaDialogComponent).visible).toBeTrue()
      list.calls.reset()
      figlio(ProrogaDialogComponent).prorogato.emit(4)
      expect(list).toHaveBeenCalledTimes(1)
    })
  })

  describe('permessi e accessibilità', () => {
    it('VIEWER: nessuna azione di scrittura, ma elenco e filtri sì', async () => {
      await apri('VIEWER', pagina(contratto({ eliminabile: true })))
      for (const id of [
        'contratti-nuovo',
        'contratti-proroga',
        'contratti-modifica-cc1',
        'contratti-stato-cc1-SOSPESO',
        'contratti-stato-cc1-ANNULLATO',
        'contratti-rinnova-cc1',
        'contratti-elimina-cc1',
      ]) {
        expect(q(id)).toBeNull()
      }
      expect(q('contratti-cerca')).toBeTruthy()
      expect(q('contratti-riga-cc1')).toBeTruthy()
    })

    it('azione Listino: collegamento alla pagina del contratto, visibile anche al VIEWER (R48)', async () => {
      await apri('VIEWER')
      const a = q<HTMLAnchorElement>('contratti-listino-cc1')!
      expect(a).toBeTruthy()
      expect(a.textContent).toContain('Listino')
      expect(a.getAttribute('href')).toBe('/contratti-clienti/cc1/listino')
      expect(a.getAttribute('aria-label')).toContain('CC-2026-001')
      // la colonna di scrittura non c'è, quella del listino sì
      expect(q('contratti-modifica-cc1')).toBeNull()
      const intest = Array.from(document.body.querySelectorAll('th')).map(t =>
        t.textContent!.trim()
      )
      expect(intest).toContain('Listino')
      expect(intest).not.toContain('Azioni')
    })

    it('colspan del vuoto per l’ADMIN: 12 colonne (scelta e azioni)', async () => {
      await apri('ADMIN', pagina())
      expect(q('contratti-listino-cc1')).toBeNull()
      expect(document.body.querySelector('td[colspan]')!.getAttribute('colspan')).toBe('12')
    })

    it('colspan del vuoto per chi scrive senza variare: 11 colonne', async () => {
      await apri('OPERATOR', pagina())
      expect(document.body.querySelector('td[colspan]')!.getAttribute('colspan')).toBe('11')
    })

    it('colspan del vuoto per il VIEWER: 10 colonne', async () => {
      await apri('VIEWER', pagina())
      expect(document.body.querySelector('td[colspan]')!.getAttribute('colspan')).toBe('10')
    })

    it('azione Listino anche per chi scrive', async () => {
      await apri('ADMIN')
      expect(q('contratti-listino-cc1')).toBeTruthy()
    })

    it('le azioni hanno un aria-label che cita il numero del contratto', async () => {
      await apri('ADMIN', pagina(contratto({ eliminabile: true })))
      for (const id of [
        'contratti-modifica-cc1',
        'contratti-stato-cc1-SOSPESO',
        'contratti-rinnova-cc1',
        'contratti-elimina-cc1',
      ]) {
        expect(bottone(id)!.getAttribute('aria-label')).toContain('CC-2026-001')
      }
    })
  })

  describe('variazioni prezzi (solo ADMIN)', () => {
    const due = () => pagina(contratto(), contratto({ id: 'cc2', numero: 'CC-2026-002' }))

    it('OPERATOR e VIEWER non vedono né il menu né la colonna di scelta', async () => {
      await apri('OPERATOR', due())
      expect(q('contratti-variazioni')).toBeNull()
      expect(q('contratti-scegli-cc1')).toBeNull()
      expect(fixture.debugElement.query(By.directive(VariazioneDialogFinta))).toBeNull()
    })

    it('il VIEWER nemmeno', async () => {
      await apri('VIEWER', due())
      expect(q('contratti-variazioni')).toBeNull()
      expect(q('contratti-scegli-cc1')).toBeNull()
    })

    it('l’ADMIN vede il menu "Variazioni prezzi" con le due voci', async () => {
      await apri('ADMIN', due())
      expect(bottone('contratti-variazioni')).not.toBeNull()
      expect(fixture.componentInstance.voci.map(v => v.label)).toEqual([
        'Modifica automatica dei prezzi',
        'Adeguamento ISTAT',
      ])
    })

    it('la voce apre il dialog della variazione senza contratti scelti', async () => {
      await apri('ADMIN', due())
      fixture.componentInstance.voci[0].command!({})
      await stabilizza(fixture)
      const d = figlio(VariazioneDialogFinta)
      expect(d.visible).toBeTrue()
      expect(d.contrattiIds).toEqual([])
    })

    it('i contratti spuntati vanno al dialog come "contratti scelti" (R51) e si possono togliere', async () => {
      await apri('ADMIN', due())
      q<HTMLInputElement>('contratti-scegli-cc2')!.click()
      await stabilizza(fixture)
      expect(q('contratti-scelti')!.textContent).toContain('1 contratto scelto')
      fixture.componentInstance.voci[0].command!({})
      await stabilizza(fixture)
      expect(figlio(VariazioneDialogFinta).contrattiIds).toEqual(['cc2'])
      bottone('contratti-deseleziona')!.click()
      await stabilizza(fixture)
      expect(q('contratti-scelti')).toBeNull()
      expect(figlio(VariazioneDialogFinta).contrattiIds).toEqual([])
    })

    it('"scegli tutti della pagina" spunta e toglie i contratti visibili', async () => {
      await apri('ADMIN', due())
      q<HTMLInputElement>('contratti-scegli-pagina')!.click()
      await stabilizza(fixture)
      expect(q('contratti-scelti')!.textContent).toContain('2 contratti scelti')
      q<HTMLInputElement>('contratti-scegli-pagina')!.click()
      await stabilizza(fixture)
      expect(q('contratti-scelti')).toBeNull()
    })

    it('la casella della pagina è indeterminata con una scelta parziale', async () => {
      await apri('ADMIN', due())
      q<HTMLInputElement>('contratti-scegli-cc1')!.click()
      await stabilizza(fixture)
      expect(q<HTMLInputElement>('contratti-scegli-pagina')!.indeterminate).toBeTrue()
      expect(q<HTMLInputElement>('contratti-scegli-pagina')!.checked).toBeFalse()
    })

    it('a variazione applicata la scelta dei contratti si svuota (voce 14)', async () => {
      await apri('ADMIN', due())
      q<HTMLInputElement>('contratti-scegli-cc1')!.click()
      await stabilizza(fixture)
      figlio(VariazioneDialogFinta).applicata.emit(2)
      await stabilizza(fixture)
      expect(q('contratti-scelti')).toBeNull()
    })

    it('la voce ISTAT apre il suo dialog; a fine variazione la lista si ricarica', async () => {
      await apri('ADMIN', due())
      fixture.componentInstance.voci[1].command!({})
      await stabilizza(fixture)
      expect(figlio(IstatDialogFinto).visible).toBeTrue()
      list.calls.reset()
      figlio(IstatDialogFinto).applicata.emit(3)
      expect(list).toHaveBeenCalledTimes(1)
      figlio(VariazioneDialogFinta).applicata.emit(2)
      expect(list).toHaveBeenCalledTimes(2)
    })
  })
})
