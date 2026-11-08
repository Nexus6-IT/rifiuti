import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { AgentiListComponent } from './agenti-list.component'
import { AgenteDialogComponent } from './agente-dialog.component'
import { ClientiService } from './clienti.service'
import { Agente, Pagina } from './clienti.model'
import { MessageService } from 'primeng/api'
import { RegistryService } from '../registry/registry.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { apriMenuRiga } from './tabelle/azioni-test-utils'
import { accettaConferma, q, scrivi, stabilizza } from './tabelle/tabelle-test-utils'

const agente = (over: Partial<Agente> = {}): Agente => ({
  id: 'a1',
  versione: 4,
  attivo: true,
  codice: 'AG1',
  note: null,
  ditta: {
    id: 'd1',
    ragioneSociale: 'Rossi S.r.l.',
    partitaIva: '12345678903',
    codiceFiscale: null,
  },
  sede: {
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
  clienti: 3,
  contratti: 5,
  eliminabile: true,
  ...over,
})

const pagina = (...e: Agente[]): Pagina<Agente> => ({ elementi: e, totale: e.length })

describe('AgentiListComponent', () => {
  let fixture: ComponentFixture<AgentiListComponent>
  let list: jasmine.Spy
  let modifica: jasmine.Spy
  let elimina: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>

  async function apri(role = 'ADMIN', primo: Pagina<Agente> = pagina(agente())) {
    list.and.returnValue(of(primo))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(AgentiListComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    list = jasmine.createSpy('list')
    modifica = jasmine.createSpy('modifica')
    elimina = jasmine.createSpy('elimina')
    toast = jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [AgentiListComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ClientiService, useValue: { agenti: { list, modifica, elimina } } },
        { provide: ToastService, useValue: toast },
        MessageService,
        { provide: RegistryService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
    TestBed.overrideComponent(AgenteDialogComponent, { set: { template: '' } })
  })
  afterEach(() => fixture?.destroy())

  it('colonne: ragione sociale, P.IVA, codice, clienti, contratti, attivo', async () => {
    await apri()
    const intest = Array.from(document.body.querySelectorAll('th')).map(t => t.textContent!.trim())
    expect(intest).toEqual(
      jasmine.arrayContaining([
        'Ragione sociale',
        'P.IVA / C.F.',
        'Codice',
        'Clienti',
        'Contratti',
        'Attivo',
      ])
    )
    const riga = q('agenti-riga-a1')!.textContent!
    expect(riga).toContain('Rossi S.r.l.')
    expect(riga).toContain('12345678903')
    expect(riga).toContain('AG1')
    expect(riga).toContain('3')
    expect(riga).toContain('5')
    expect(riga).not.toContain('a1')
  })

  it('un solo caricamento iniziale, con pagina 1 e dimensione di default', async () => {
    await apri()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ pagina: 1, dimensione: 25 }))
  })

  it('mostra anche i disattivati (soloAttivi non viene mandato)', async () => {
    await apri()
    expect(list.calls.mostRecent().args[0].soloAttivi).toBeUndefined()
  })

  it('ricerca con debounce: una sola chiamata, di nuovo a pagina 1', fakeAsync(() => {
    list.and.returnValue(of(pagina(agente())))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'ADMIN' }) } })
    fixture = TestBed.createComponent(AgentiListComponent)
    fixture.detectChanges()
    tick()
    list.calls.reset()
    scrivi('agenti-cerca', 'ro')
    scrivi('agenti-cerca', 'ros')
    scrivi('agenti-cerca', 'ross')
    tick(100)
    expect(list).not.toHaveBeenCalled()
    tick(300)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ testo: 'ross', pagina: 1 }))
  }))

  it('paginazione lazy: pagina e dimensione dal paginator', async () => {
    await apri()
    list.calls.reset()
    list.and.returnValue(of({ elementi: [agente()], totale: 60 }))
    fixture.componentInstance.cambiaPagina({ first: 50, rows: 25 })
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ pagina: 3, dimensione: 25 }))
    expect(fixture.componentInstance.totale()).toBe(60)
  })

  it('una risposta in ritardo non sovrascrive quella attuale', async () => {
    await apri()
    const vecchia = new Subject<Pagina<Agente>>()
    const nuova = new Subject<Pagina<Agente>>()
    list.and.returnValues(vecchia, nuova)
    fixture.componentInstance.carica()
    fixture.componentInstance.carica()
    nuova.next(pagina(agente({ id: 'a2', codice: 'NUOVO' })))
    vecchia.next(pagina(agente({ id: 'a3', codice: 'VECCHIO' })))
    expect(fixture.componentInstance.righe().map(r => r.codice)).toEqual(['NUOVO'])
  })

  it('cambiaStato manda lo stato opposto e la versione', async () => {
    await apri()
    modifica.and.returnValue(of(agente({ attivo: false })))
    fixture.componentInstance.cambiaStato(agente())
    expect(modifica).toHaveBeenCalledOnceWith('a1', { attivo: false, versione: 4 })
  })

  it('Disattiva chiede conferma e poi disattiva', async () => {
    await apri()
    modifica.and.returnValue(of(agente({ attivo: false })))
    fixture.componentInstance.disattiva(agente())
    await stabilizza(fixture)
    expect(modifica).not.toHaveBeenCalled()
    accettaConferma()
    await stabilizza(fixture)
    expect(modifica).toHaveBeenCalledOnceWith('a1', { attivo: false, versione: 4 })
  })

  it('Riattiva non chiede conferma', async () => {
    await apri('ADMIN', pagina(agente({ attivo: false })))
    modifica.and.returnValue(of(agente()))
    fixture.componentInstance.disattiva(agente({ attivo: false }))
    expect(modifica).toHaveBeenCalledOnceWith('a1', { attivo: true, versione: 4 })
  })

  it('Elimina solo se eliminabile', async () => {
    await apri('ADMIN', pagina(agente({ eliminabile: false })))
    expect(await apriMenuRiga(fixture, q('agenti-riga-a1')!)).toEqual(['Disattiva'])
  })

  it("eliminabile: il pulsante Elimina c'è", async () => {
    await apri('ADMIN', pagina(agente({ eliminabile: true })))
    expect(await apriMenuRiga(fixture, q('agenti-riga-a1')!)).toEqual(['Disattiva', 'Elimina'])
  })

  it('Elimina: conferma e poi manda id e versione', async () => {
    await apri()
    elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(agente())
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(elimina).toHaveBeenCalledOnceWith('a1', 4)
  })

  it('409 AGENTE_IN_USO: toast col messaggio del backend e ricarica', async () => {
    await apri()
    elimina.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { code: 'AGENTE_IN_USO', message: "L'agente è usato da clienti o contratti." },
      }))
    )
    list.calls.reset()
    fixture.componentInstance.eliminaConfermato(agente())
    expect(toast.error).toHaveBeenCalledWith("L'agente è usato da clienti o contratti.")
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('agenti-nuovo')).toBeNull()
    expect(
      document.body.querySelector('[data-testid="azione-principale"], [data-testid="azioni-altre"]')
    ).toBeNull()
  })

  it('errore di caricamento: messaggio del backend', async () => {
    list.and.returnValue(throwError(() => ({ error: { message: 'Servizio non disponibile.' } })))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'ADMIN' }) } })
    fixture = TestBed.createComponent(AgentiListComponent)
    await stabilizza(fixture)
    expect(document.body.textContent).toContain('Servizio non disponibile.')
  })

  it('Nuovo e Modifica aprono il dialog', async () => {
    await apri()
    fixture.componentInstance.apri(null)
    expect(fixture.componentInstance.dialogoAperto()).toBeTrue()
    expect(fixture.componentInstance.selezionato()).toBeNull()
    fixture.componentInstance.apri(agente())
    expect(fixture.componentInstance.selezionato()?.id).toBe('a1')
  })
})
