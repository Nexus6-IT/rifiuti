import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { SpeseAccessorieComponent } from './spese-accessorie.component'
import { ListinoService } from '../../listino/listino.service'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { SpesaAccessoria } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { accettaConferma, q, stabilizza, tabellaFinta } from './tabelle-test-utils'

const spesa: SpesaAccessoria = {
  id: 's1',
  versione: 1,
  eliminabile: true,
  tipo: 'BOLLO',
  codice: 'B1',
  descrizione: 'Bollo virtuale',
  importo: '2.00',
  attiva: true,
  codiceIvaId: null,
}

describe('SpeseAccessorieComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<SpeseAccessorieComponent>

  async function apri(role = 'ADMIN') {
    tabella.list.and.returnValue(of([spesa]))
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(SpeseAccessorieComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    TestBed.configureTestingModule({
      imports: [SpeseAccessorieComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { spese: tabella } },
        { provide: ListinoService, useValue: { codiciIva: { list: () => of([]) } } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success']),
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('elenco con tipo e importo', async () => {
    await apri()
    const t = q('spesa-riga-B1')!.textContent!
    expect(t).toContain('Bollo')
    expect(t).toContain('2.00')
  })

  it('filtro per tipo', async () => {
    await apri()
    fixture.componentInstance.impostaFiltro('BOLLO')
    await stabilizza(fixture)
    expect(tabella.list).toHaveBeenCalledWith({ incluseDisattivate: true, tipo: 'BOLLO' })
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('spesa-nuova')).toBeNull()
    expect(q('spesa-modifica-B1')).toBeNull()
    expect(q('spesa-attiva-B1')).toBeNull()
    expect(q('spesa-elimina-B1')).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(spesa)
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('s1', 1)
  })
})
