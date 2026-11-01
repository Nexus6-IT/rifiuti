import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { TestiFatturazioneComponent } from './testi-fatturazione.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { TestoFatturazione } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { accettaConferma, q, stabilizza, tabellaFinta } from './tabelle-test-utils'

const testo: TestoFatturazione = {
  id: 't1',
  versione: 1,
  eliminabile: true,
  codice: 'AB',
  titolo: 'Pagamento',
  righe: ['Bonifico entro 30 giorni', 'IBAN sul retro'],
  attivo: true,
}

describe('TestiFatturazioneComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<TestiFatturazioneComponent>

  async function apri(role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(TestiFatturazioneComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    tabella.list.and.returnValue(of([testo]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [TestiFatturazioneComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { testi: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("anteprima delle righe nell'elenco (titolo e prima riga)", async () => {
    await apri()
    const t = q('testo-riga-AB')!.textContent!
    expect(t).toContain('Pagamento')
    expect(t).toContain('Bonifico entro 30 giorni')
    expect(t).not.toContain('IBAN sul retro')
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('testo-nuovo')).toBeNull()
    expect(q('testo-modifica-AB')).toBeNull()
    expect(q('testo-attivo-AB')).toBeNull()
    expect(q('testo-elimina-AB')).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(testo)
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('t1', 1)
  })

  it("errore sull'eliminazione: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.elimina.and.returnValue(throwError(() => ({ error: { message: 'In uso.' } })))
    fixture.componentInstance.eliminaConfermata(testo)
    expect(toast.error).toHaveBeenCalledWith('In uso.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it("errore sul cambio di stato: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.modifica.and.returnValue(throwError(() => ({ error: { message: 'Conflitto.' } })))
    fixture.componentInstance.cambiaStato(testo)
    expect(tabella.modifica).toHaveBeenCalledWith('t1', { attivo: false, versione: 1 })
    expect(toast.error).toHaveBeenCalledWith('Conflitto.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })
})
