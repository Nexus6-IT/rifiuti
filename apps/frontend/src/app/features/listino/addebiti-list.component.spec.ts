import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { AddebitiListComponent } from './addebiti-list.component'
import { AddebitoDialogComponent } from './addebito-dialog.component'
import { VariazioneArchivioDialogComponent } from './variazione-archivio-dialog.component'
import { ListinoService } from './listino.service'
import { Addebito } from './listino.model'
import { Pagina } from '../clienti/clienti.model'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import {
  accettaConferma,
  bottone,
  q,
  scrivi,
  stabilizza,
} from '../clienti/tabelle/tabelle-test-utils'
import { apriMenuRiga } from '../clienti/tabelle/azioni-test-utils'

const rif = (id: string, codice: string, descrizione: string) => ({ id, codice, descrizione })

const addebito = (over: Partial<Addebito> = {}): Addebito => ({
  id: 'ad1',
  codice: '00001',
  descrizione: 'Trasporto rifiuti',
  gruppo: rif('g1', '001', 'Trasporti'),
  unitaMisura: 'KG',
  codiceIva: rif('i1', '22', 'Ordinaria'),
  tipo: 'V',
  etichettaTipo: 'La quantità va specificata in immissione documento',
  categoria: null,
  tipoProvvigione: 'SCONTATO',
  centroRicavo: null,
  categoriaStatistica1: null,
  categoriaStatistica2: null,
  notaUsoInterno: null,
  appunti: null,
  listini: [1, 2, 3, 4, 5, 6].map(n => ({
    numero: n as 1,
    prezzo: n === 1 ? '10.50' : null,
    sconto: null,
    provvigione: null,
  })),
  attivo: true,
  versione: 4,
  eliminabile: true,
  ...over,
})

const pagina = (...e: Addebito[]): Pagina<Addebito> => ({ elementi: e, totale: e.length })

describe('AddebitiListComponent', () => {
  let fixture: ComponentFixture<AddebitiListComponent>
  let list: jasmine.Spy
  let modifica: jasmine.Spy
  let elimina: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>

  async function apri(role = 'ADMIN', primo: Pagina<Addebito> = pagina(addebito())) {
    list.and.returnValue(of(primo))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(AddebitiListComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    list = jasmine.createSpy('list')
    modifica = jasmine.createSpy('modifica')
    elimina = jasmine.createSpy('elimina')
    toast = jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [AddebitiListComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { addebiti: { list, modifica, elimina } } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
    TestBed.overrideComponent(AddebitoDialogComponent, { set: { template: '' } })
    TestBed.overrideComponent(VariazioneArchivioDialogComponent, { set: { template: '' } })
  })
  afterEach(() => fixture?.destroy())

  it('colonne e riga: codice, descrizione, gruppo, tipo, listino 1; mai l’id', async () => {
    await apri()
    const riga = q('addebiti-riga-ad1')!.textContent!
    expect(riga).toContain('00001')
    expect(riga).toContain('Trasporto rifiuti')
    expect(riga).toContain('Trasporti')
    expect(riga).toContain('V')
    expect(riga).toContain('10.50')
    expect(riga).not.toContain('ad1')
  })

  it('un solo caricamento iniziale con pagina 1, dimensione 25 e senza soloAttivi', async () => {
    await apri()
    expect(list).toHaveBeenCalledTimes(1)
    const filtro = list.calls.mostRecent().args[0]
    expect(filtro).toEqual(jasmine.objectContaining({ pagina: 1, dimensione: 25 }))
    expect(filtro.soloAttivi).toBeUndefined()
  })

  it('ricerca con debounce a pagina 1', fakeAsync(() => {
    list.and.returnValue(of(pagina(addebito())))
    fixture = TestBed.createComponent(AddebitiListComponent)
    fixture.detectChanges()
    tick()
    list.calls.reset()
    scrivi('addebiti-cerca', 'tra')
    scrivi('addebiti-cerca', 'tras')
    tick(300)
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ testo: 'tras', pagina: 1 }))
    fixture.destroy()
  }))

  it('"Solo attivi" manda soloAttivi=true e torna a pagina 1', async () => {
    await apri()
    list.calls.reset()
    fixture.componentInstance.impostaSoloAttivi(true)
    expect(list).toHaveBeenCalledOnceWith(jasmine.objectContaining({ soloAttivi: true, pagina: 1 }))
    list.calls.reset()
    fixture.componentInstance.impostaSoloAttivi(false)
    expect(list.calls.mostRecent().args[0].soloAttivi).toBeUndefined()
  })

  it('una risposta in ritardo non sovrascrive quella attuale', async () => {
    await apri()
    const vecchia = new Subject<Pagina<Addebito>>()
    const nuova = new Subject<Pagina<Addebito>>()
    list.and.returnValues(vecchia, nuova)
    fixture.componentInstance.carica()
    fixture.componentInstance.carica()
    nuova.next(pagina(addebito({ id: 'ad2', codice: 'NUOVO' })))
    vecchia.next(pagina(addebito({ id: 'ad3', codice: 'VECCHIO' })))
    expect(fixture.componentInstance.righe().map(r => r.codice)).toEqual(['NUOVO'])
  })

  it('cambiaStato manda lo stato opposto e la versione', async () => {
    await apri()
    modifica.and.returnValue(of(addebito({ attivo: false })))
    fixture.componentInstance.cambiaStato(addebito())
    expect(modifica).toHaveBeenCalledOnceWith('ad1', { attivo: false, versione: 4 })
  })

  it('Elimina: conferma e poi manda id e versione', async () => {
    await apri()
    elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(addebito())
    await stabilizza(fixture)
    expect(elimina).not.toHaveBeenCalled()
    accettaConferma()
    await stabilizza(fixture)
    expect(elimina).toHaveBeenCalledOnceWith('ad1', 4)
  })

  it('409: toast col messaggio del backend e ricarica', async () => {
    await apri()
    elimina.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { message: "L'addebito è stato modificato da un altro utente." },
      }))
    )
    list.calls.reset()
    fixture.componentInstance.eliminaConfermato(addebito())
    expect(toast.error).toHaveBeenCalledWith("L'addebito è stato modificato da un altro utente.")
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('Elimina solo se eliminabile', async () => {
    await apri('ADMIN', pagina(addebito({ eliminabile: false })))
    expect(await apriMenuRiga(fixture, q('addebiti-riga-ad1')!)).toEqual([
      'Varia i prezzi…',
      'Disattiva',
    ])
  })

  it('VIEWER: nessun pulsante di scrittura né di variazione', async () => {
    await apri('VIEWER')
    for (const id of ['addebiti-nuovo', 'addebiti-variazione']) {
      expect(q(id)).toBeNull()
    }
    expect(
      document.body.querySelector('[data-testid="azione-principale"], [data-testid="azioni-altre"]')
    ).toBeNull()
  })

  it('OPERATOR scrive ma non può fare la variazione di massa (solo SUPER_ADMIN e ADMIN)', async () => {
    await apri('OPERATOR')
    expect(q('addebiti-nuovo')).toBeTruthy()
    expect(q('addebiti-variazione')).toBeNull()
    expect(await apriMenuRiga(fixture, q('addebiti-riga-ad1')!)).not.toContain('Varia i prezzi…')
  })

  it('ADMIN vede la variazione di massa e quella della riga', async () => {
    await apri('ADMIN')
    expect(q('addebiti-variazione')).toBeTruthy()
    expect(await apriMenuRiga(fixture, q('addebiti-riga-ad1')!)).toContain('Varia i prezzi…')
  })

  it('Nuovo e Modifica aprono il dialog; Variazione apre il dialog di variazione', async () => {
    await apri()
    fixture.componentInstance.apri(null)
    expect(fixture.componentInstance.dialogoAperto()).toBeTrue()
    expect(fixture.componentInstance.selezionato()).toBeNull()
    fixture.componentInstance.apri(addebito())
    expect(fixture.componentInstance.selezionato()?.id).toBe('ad1')
    bottone('addebiti-variazione')!.click()
    expect(fixture.componentInstance.variazioneAperta()).toBeTrue()
  })

  it('errore di caricamento: messaggio del backend', async () => {
    list.and.returnValue(throwError(() => ({ error: { message: 'Servizio non disponibile.' } })))
    fixture = TestBed.createComponent(AddebitiListComponent)
    await stabilizza(fixture)
    expect(document.body.textContent).toContain('Servizio non disponibile.')
  })
})
