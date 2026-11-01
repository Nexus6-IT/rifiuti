import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Router } from '@angular/router'
import { MessageService } from 'primeng/api'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RegistryService } from '../registry/registry.service'
import { ClienteDialogComponent } from './cliente-dialog.component'
import { ClientiListComponent } from './clienti-list.component'
import { Cliente, Pagina } from './clienti.model'
import { ClientiService } from './clienti.service'
import { TabelleFatturazioneService } from './tabelle-fatturazione.service'
import { accettaConferma, bottone, q, scrivi, stabilizza } from './tabelle/tabelle-test-utils'

const cliente = (over: Partial<Cliente> = {}): Cliente => ({
  id: 'cl1',
  versione: 4,
  attivo: true,
  codice: 'CL1',
  codiceDestinatario: 'ABCDEFG',
  pecFatturazione: null,
  riferimentoAmministrazione: null,
  iban: null,
  contoCorrenteId: null,
  condizionePagamentoId: 'c1',
  esigibilitaIva: 'IMMEDIATA',
  registroIvaId: null,
  speseIncassoId: null,
  bolloId: null,
  agenteId: 'a1',
  ritenutaPercentuale: null,
  nome: null,
  cognome: null,
  note: null,
  ditta: {
    id: 'd1',
    ragioneSociale: 'Verdi Servizi S.r.l.',
    partitaIva: '12345678903',
    codiceFiscale: null,
    privato: false,
  },
  sedeFatturazione: {
    id: 's1',
    denominazione: null,
    via: 'Via Roma',
    civico: '1',
    cap: '00100',
    citta: 'Roma',
    provincia: 'RM',
    referente: null,
    email: null,
    telefono: null,
    pec: null,
    principale: true,
    attiva: true,
  },
  condizionePagamento: { id: 'c1', codice: '30FM', descrizione: '30 gg fine mese' },
  contoCorrente: null,
  registroIva: null,
  speseIncasso: null,
  bollo: null,
  agente: { id: 'a1', codice: 'AG1', descrizione: 'Rossi Provvigioni' },
  contratti: 7,
  eliminabile: true,
  ...over,
})

const pagina = (...e: Cliente[]): Pagina<Cliente> => ({ elementi: e, totale: e.length })

describe('ClientiListComponent', () => {
  let fixture: ComponentFixture<ClientiListComponent>
  let list: jasmine.Spy
  let get: jasmine.Spy
  let modifica: jasmine.Spy
  let elimina: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>

  async function apri(role = 'ADMIN', primo: Pagina<Cliente> = pagina(cliente())) {
    list.and.returnValue(of(primo))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(ClientiListComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    list = jasmine.createSpy('list')
    get = jasmine.createSpy('get')
    modifica = jasmine.createSpy('modifica')
    elimina = jasmine.createSpy('elimina')
    toast = jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [ClientiListComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ClientiService, useValue: { clienti: { list, get, modifica, elimina } } },
        { provide: ToastService, useValue: toast },
        { provide: TabelleFatturazioneService, useValue: {} },
        MessageService,
        { provide: RegistryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
    TestBed.overrideComponent(ClienteDialogComponent, { set: { template: '' } })
  })
  afterEach(() => fixture?.destroy())

  it('titolo e colonne: ragione sociale, P.IVA o CF, codice, codice destinatario, condizione, agente, contratti, attivo', async () => {
    await apri()
    expect(document.body.querySelector('h1')!.textContent).toContain('Clienti')
    const intest = Array.from(document.body.querySelectorAll('th')).map(t => t.textContent!.trim())
    expect(intest).toEqual(
      jasmine.arrayContaining([
        'Ragione sociale',
        'P.IVA / C.F.',
        'Codice',
        'Codice destinatario',
        'Condizione di pagamento',
        'Agente',
        'Contratti',
        'Attivo',
      ])
    )
    const riga = q('clienti-riga-cl1')!.textContent!
    for (const t of [
      'Verdi Servizi S.r.l.',
      '12345678903',
      'CL1',
      'ABCDEFG',
      '30 gg fine mese',
      'Rossi Provvigioni',
      '7',
      'Sì',
    ]) {
      expect(riga).toContain(t)
    }
    expect(riga).not.toContain('cl1')
  })

  it('un solo caricamento iniziale, pagina 1 e dimensione di default, anche i disattivati', async () => {
    await apri()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ pagina: 1, dimensione: 25 }))
    expect(list.calls.mostRecent().args[0].soloAttivi).toBeUndefined()
  })

  it('ricerca con debounce: una sola chiamata con il testo, di nuovo a pagina 1', fakeAsync(() => {
    list.and.returnValue(of(pagina(cliente())))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'ADMIN' }) } })
    fixture = TestBed.createComponent(ClientiListComponent)
    fixture.detectChanges()
    tick()
    list.calls.reset()
    scrivi('clienti-cerca', 've')
    scrivi('clienti-cerca', 'ver')
    scrivi('clienti-cerca', 'verdi')
    tick(100)
    expect(list).not.toHaveBeenCalled()
    tick(300)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ testo: 'verdi', pagina: 1 }))
  }))

  it('paginazione lazy: pagina e dimensione dal paginator, totale dal backend', async () => {
    await apri()
    list.calls.reset()
    list.and.returnValue(of({ elementi: [cliente()], totale: 60 }))
    fixture.componentInstance.cambiaPagina({ first: 50, rows: 25 })
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ pagina: 3, dimensione: 25 }))
    expect(fixture.componentInstance.totale()).toBe(60)
  })

  it('una risposta in ritardo non sovrascrive quella attuale', async () => {
    await apri()
    const vecchia = new Subject<Pagina<Cliente>>()
    const nuova = new Subject<Pagina<Cliente>>()
    list.and.returnValues(vecchia, nuova)
    fixture.componentInstance.carica()
    fixture.componentInstance.carica()
    nuova.next(pagina(cliente({ id: 'cl2', codice: 'NUOVO' })))
    vecchia.next(pagina(cliente({ id: 'cl3', codice: 'VECCHIO' })))
    expect(fixture.componentInstance.righe().map(r => r.codice)).toEqual(['NUOVO'])
  })

  it('Disattiva chiede conferma e poi manda attivo false e la versione', async () => {
    await apri()
    modifica.and.returnValue(of(cliente({ attivo: false })))
    fixture.componentInstance.disattiva(cliente())
    await stabilizza(fixture)
    expect(modifica).not.toHaveBeenCalled()
    accettaConferma()
    await stabilizza(fixture)
    expect(modifica).toHaveBeenCalledOnceWith('cl1', { attivo: false, versione: 4 })
  })

  it('Riattiva non chiede conferma', async () => {
    await apri('ADMIN', pagina(cliente({ attivo: false })))
    modifica.and.returnValue(of(cliente()))
    fixture.componentInstance.disattiva(cliente({ attivo: false }))
    expect(modifica).toHaveBeenCalledOnceWith('cl1', { attivo: true, versione: 4 })
  })

  it('Elimina solo se eliminabile', async () => {
    await apri('ADMIN', pagina(cliente({ eliminabile: false })))
    expect(q('clienti-elimina-cl1')).toBeNull()
  })

  it("eliminabile: il pulsante Elimina c'è", async () => {
    await apri('ADMIN', pagina(cliente({ eliminabile: true })))
    expect(q('clienti-elimina-cl1')).toBeTruthy()
  })

  it('Elimina: conferma con il testo previsto e poi manda id e versione', async () => {
    await apri()
    elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(cliente())
    await stabilizza(fixture)
    expect(document.body.textContent).toContain(
      'Eliminare il cliente Verdi Servizi S.r.l.? La ditta e le sedi restano.'
    )
    accettaConferma()
    await stabilizza(fixture)
    expect(elimina).toHaveBeenCalledOnceWith('cl1', 4)
  })

  it('409 CLIENTE_CON_CONTRATTI: toast col messaggio del backend e ricarica', async () => {
    await apri()
    elimina.and.returnValue(
      throwError(() => ({
        status: 409,
        error: {
          error: 'CLIENTE_CON_CONTRATTI',
          message: 'Il cliente ha dei contratti: non si elimina.',
        },
      }))
    )
    list.calls.reset()
    fixture.componentInstance.eliminaConfermato(cliente())
    expect(toast.error).toHaveBeenCalledWith('Il cliente ha dei contratti: non si elimina.')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('azioni con aria-label che cita la ragione sociale', async () => {
    await apri()
    for (const id of ['clienti-modifica-cl1', 'clienti-attiva-cl1', 'clienti-elimina-cl1']) {
      expect(bottone(id)!.getAttribute('aria-label')).toContain('Verdi Servizi S.r.l.')
    }
  })

  it('VIEWER: nessun pulsante di scrittura, ma Agenti e Tabelle restano', async () => {
    await apri('VIEWER')
    for (const id of [
      'clienti-nuovo',
      'clienti-modifica-cl1',
      'clienti-attiva-cl1',
      'clienti-elimina-cl1',
    ]) {
      expect(q(id)).toBeNull()
    }
    expect(q('clienti-agenti')).toBeTruthy()
    expect(q('clienti-tabelle')).toBeTruthy()
    expect(q('clienti-addebiti')).toBeTruthy()
  })

  it('"Archivio addebiti" porta alla rotta piatta clienti/addebiti', async () => {
    await apri()
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true)
    expect(bottone('clienti-addebiti')!.textContent).toContain('Archivio addebiti')
    bottone('clienti-addebiti')!.click()
    expect(navigate).toHaveBeenCalledWith('/clienti/addebiti')
  })

  it('i pulsanti "Agenti" e "Tabelle di fatturazione" portano alle rotte di D20', async () => {
    await apri()
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true)
    bottone('clienti-agenti')!.click()
    expect(navigate).toHaveBeenCalledWith('/clienti/agenti')
    bottone('clienti-tabelle')!.click()
    expect(navigate).toHaveBeenCalledWith('/clienti/tabelle')
    expect(bottone('clienti-tabelle')!.textContent).toContain('Tabelle di fatturazione')
  })

  it('errore di caricamento: messaggio del backend', async () => {
    list.and.returnValue(throwError(() => ({ error: { message: 'Servizio non disponibile.' } })))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'ADMIN' }) } })
    fixture = TestBed.createComponent(ClientiListComponent)
    await stabilizza(fixture)
    expect(document.body.textContent).toContain('Servizio non disponibile.')
  })

  it('Nuovo apre il dialog senza cliente', async () => {
    await apri()
    fixture.componentInstance.apriNuovo()
    expect(fixture.componentInstance.dialogoAperto()).toBeTrue()
    expect(fixture.componentInstance.selezionato()).toBeNull()
  })

  it('apriModifica rilegge il cliente prima di aprire il dialog', async () => {
    await apri()
    get.and.returnValue(of(cliente({ versione: 9, codice: 'FRESCO' })))
    fixture.componentInstance.apriModifica(cliente())
    expect(get).toHaveBeenCalledOnceWith('cl1')
    expect(fixture.componentInstance.selezionato()?.versione).toBe(9)
    expect(fixture.componentInstance.dialogoAperto()).toBeTrue()
  })

  it('apriModifica con la GET fallita: toast, ricarica e dialog chiuso', async () => {
    await apri()
    get.and.returnValue(throwError(() => ({ error: { message: 'Non trovato.' } })))
    list.calls.reset()
    fixture.componentInstance.apriModifica(cliente())
    expect(toast.error).toHaveBeenCalledWith('Non trovato.')
    expect(fixture.componentInstance.dialogoAperto()).toBeFalse()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('dopo il salvataggio dal dialog la lista si ricarica', async () => {
    await apri()
    list.calls.reset()
    fixture.componentInstance.dopoSalvataggio()
    expect(list).toHaveBeenCalledTimes(1)
  })
})
