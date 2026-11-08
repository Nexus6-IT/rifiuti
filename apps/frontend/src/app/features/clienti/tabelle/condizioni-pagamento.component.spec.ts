import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { CondizioniPagamentoComponent } from './condizioni-pagamento.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CondizionePagamento } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { apriMenuRiga, chiudiMenuRiga, scegliVoceRiga } from './azioni-test-utils'
import { accettaConferma, bottone, q, stabilizza, tabellaFinta } from './tabelle-test-utils'

const condizione = (p: Partial<CondizionePagamento> = {}): CondizionePagamento => ({
  id: 'c1',
  versione: 3,
  eliminabile: true,
  codice: '3060',
  descrizione: 'Trenta e sessanta',
  modalita: 'MP05',
  giorniRate: [30, 60],
  fineMese: true,
  attiva: true,
  descrizioneRate: '30-60 gg fine mese',
  ...p,
})

describe('CondizioniPagamentoComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CondizioniPagamentoComponent>

  async function apri(righe: CondizionePagamento[], role = 'ADMIN') {
    tabella.list.and.returnValue(of(righe))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(CondizioniPagamentoComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [CondizioniPagamentoComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { condizioni: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('elenco con codice, descrizione, modalità e rate descritte', async () => {
    await apri([condizione()])
    const t = q('cond-riga-3060')!.textContent!
    expect(t).toContain('3060')
    expect(t).toContain('Trenta e sessanta')
    expect(t).toContain('Bonifico')
    expect(t).toContain('30-60 gg fine mese')
    expect(tabella.list).toHaveBeenCalledWith({ incluseDisattivate: true })
  })

  it('"Nuova condizione" apre il dialog vuoto', async () => {
    await apri([])
    expect(q('cond-dlg-codice')).toBeNull()
    bottone('cond-nuova')!.click()
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('cond-dlg-codice')!.value).toBe('')
  })

  it('409 CONDIZIONE_PAGAMENTO_IN_USO: toast col messaggio e la riga resta', async () => {
    await apri([condizione()])
    tabella.elimina.and.returnValue(
      throwError(() => ({
        error: { code: 'CONDIZIONE_PAGAMENTO_IN_USO', message: 'La condizione è in uso.' },
      }))
    )
    fixture.componentInstance.eliminaConfermata(condizione())
    await stabilizza(fixture)
    expect(toast.error).toHaveBeenCalledWith('La condizione è in uso.')
    expect(q('cond-riga-3060')).not.toBeNull()
  })

  it('Elimina visibile solo se eliminabile', async () => {
    await apri([condizione(), condizione({ id: 'c2', codice: 'RB', eliminabile: false })])
    expect(await apriMenuRiga(fixture, q('cond-riga-3060')!)).toContain('Elimina')
    chiudiMenuRiga()
    expect(await apriMenuRiga(fixture, q('cond-riga-RB')!)).not.toContain('Elimina')
  })

  it('Disattiva/Riattiva manda attiva e versione', async () => {
    await apri([condizione()])
    tabella.modifica.and.returnValue(of(condizione({ attiva: false, versione: 4 })))
    await scegliVoceRiga(fixture, q('cond-riga-3060')!, 'Disattiva')
    // «Disattiva» chiede conferma: finche' non si accetta non parte nulla
    expect(tabella.modifica).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Conferma disattivazione')
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith('c1', { attiva: false, versione: 3 })
  })

  it('Riattiva parte subito, senza conferma', async () => {
    await apri([condizione({ attiva: false })])
    tabella.modifica.and.returnValue(of(condizione({ attiva: true, versione: 4 })))
    await scegliVoceRiga(fixture, q('cond-riga-3060')!, 'Riattiva')
    expect(document.body.textContent).not.toContain('Conferma disattivazione')
    expect(tabella.modifica).toHaveBeenCalledWith('c1', { attiva: true, versione: 3 })
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri([condizione()], 'VIEWER')
    expect(q('cond-nuova')).toBeNull()
    expect(
      document.body.querySelector('[data-testid="azione-principale"], [data-testid="azioni-altre"]')
    ).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri([condizione()])
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(condizione())
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('c1', 3)
  })

  it("dopo un errore in eliminazione ricarica l'elenco", async () => {
    await apri([condizione()])
    tabella.elimina.and.returnValue(throwError(() => ({ error: { message: 'Versione vecchia.' } })))
    tabella.list.calls.reset()
    fixture.componentInstance.eliminaConfermata(condizione())
    expect(tabella.list).toHaveBeenCalledTimes(1)
  })
})
