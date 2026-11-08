import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { CodificheContrattoComponent } from './codifiche-contratto.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CodificaContratto } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { accettaConferma, q, stabilizza, tabellaFinta } from './tabelle-test-utils'

const categoria: CodificaContratto = {
  id: 'c1',
  versione: 1,
  eliminabile: true,
  genere: 'CATEGORIA',
  codice: '001',
  descrizione: 'Industriale',
  attiva: true,
}

describe('CodificheContrattoComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta> & { prossimoCodice: jasmine.Spy }
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CodificheContrattoComponent>

  async function apri(role = 'ADMIN', genere = 'CATEGORIA') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(CodificheContrattoComponent)
    fixture.componentRef.setInput('genere', genere)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = Object.assign(tabellaFinta(), {
      prossimoCodice: jasmine.createSpy('prossimoCodice').and.returnValue(of('002')),
    })
    tabella.list.and.returnValue(of([categoria]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [CodificheContrattoComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { codifiche: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('elenca il genere ricevuto, anche i disattivati', async () => {
    await apri('ADMIN', 'MOTIVO_ANNULLO')
    expect(tabella.list).toHaveBeenCalledWith('MOTIVO_ANNULLO', true)
    expect(q('codifiche-titolo-MOTIVO_ANNULLO')!.textContent).toContain('Motivi di annullo')
  })

  it('"Nuova" propone il codice da prossimoCodice', async () => {
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    expect(tabella.prossimoCodice).toHaveBeenCalledWith('CATEGORIA')
    expect(q<HTMLInputElement>('codifica-dlg-codice')!.value).toBe('002')
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('codifica-nuova-CATEGORIA')).toBeNull()
    expect(
      document.body.querySelector('[data-testid="azione-principale"], [data-testid="azioni-altre"]')
    ).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(categoria)
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('c1', 1)
  })

  it("errore sull'eliminazione: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.elimina.and.returnValue(throwError(() => ({ error: { message: 'In uso.' } })))
    fixture.componentInstance.eliminaConfermata(categoria)
    expect(toast.error).toHaveBeenCalledWith('In uso.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it("errore sul cambio di stato: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.modifica.and.returnValue(throwError(() => ({ error: { message: 'Conflitto.' } })))
    fixture.componentInstance.cambiaStato(categoria)
    expect(tabella.modifica).toHaveBeenCalledWith('c1', { attiva: false, versione: 1 })
    expect(toast.error).toHaveBeenCalledWith('Conflitto.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })
})
