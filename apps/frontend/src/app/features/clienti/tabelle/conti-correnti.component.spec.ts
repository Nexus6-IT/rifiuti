import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { ContiCorrentiComponent } from './conti-correnti.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ContoCorrenteInElenco } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { accettaConferma, q, stabilizza, tabellaFinta } from './tabelle-test-utils'

const conto: ContoCorrenteInElenco = {
  id: 'k1',
  versione: 2,
  eliminabile: true,
  codice: 'BP',
  descrizione: 'Principale',
  banca: 'Banca Popolare',
  bic: null,
  attivo: true,
  ibanMascherato: 'IT60 **** **** 3456',
}

describe('ContiCorrentiComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<ContiCorrentiComponent>

  async function apri(role = 'ADMIN') {
    tabella.list.and.returnValue(of([conto]))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(ContiCorrentiComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    TestBed.configureTestingModule({
      imports: [ContiCorrentiComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { conti: tabella } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success']),
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("IBAN mascherato nell'elenco", async () => {
    await apri()
    const t = q('conto-riga-BP')!.textContent!
    expect(t).toContain('IT60 **** **** 3456')
    expect(t).toContain('Banca Popolare')
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('conto-nuovo')).toBeNull()
    expect(
      document.body.querySelector('[data-testid="azione-principale"], [data-testid="azioni-altre"]')
    ).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(conto)
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('k1', 2)
  })
})
