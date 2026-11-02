import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { CodificheAddebitoTabComponent } from './codifiche-addebito-tab.component'
import { ListinoService } from '../listino.service'
import { CodificaAddebito } from '../listino.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import {
  accettaConferma,
  q,
  stabilizza,
  tabellaFinta,
} from '../../clienti/tabelle/tabelle-test-utils'

const gruppo: CodificaAddebito = {
  id: 'g1',
  versione: 1,
  eliminabile: true,
  genere: 'GRUPPO',
  codice: '001',
  descrizione: 'Trasporti',
  attiva: true,
}

describe('CodificheAddebitoTabComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta> & { prossimoCodice: jasmine.Spy }
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CodificheAddebitoTabComponent>

  async function apri(role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(CodificheAddebitoTabComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = Object.assign(tabellaFinta(), {
      prossimoCodice: jasmine.createSpy('prossimoCodice').and.returnValue(of('002')),
    })
    tabella.list.and.returnValue(of([gruppo]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [CodificheAddebitoTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { codifiche: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('parte dal genere Gruppo, con le disattivate, e offre i cinque generi', async () => {
    await apri()
    expect(tabella.list).toHaveBeenCalledWith('GRUPPO', true)
    expect(q('codifica-add-riga-001')!.textContent).toContain('Trasporti')
    expect(fixture.componentInstance.generi.length).toBe(5)
    expect(document.body.textContent).toContain('Centro di ricavo')
  })

  it("cambiando genere rilegge l'elenco di quel genere", async () => {
    await apri()
    tabella.list.and.returnValue(of([]))
    fixture.componentInstance.scegli('CENTRO_RICAVO')
    await stabilizza(fixture)
    expect(tabella.list).toHaveBeenCalledWith('CENTRO_RICAVO', true)
    expect(q('codifica-add-riga-001')).toBeNull()
  })

  it("una risposta in ritardo del genere precedente non riempie l'elenco del corrente", async () => {
    const prima = new Subject<CodificaAddebito[]>()
    const seconda = new Subject<CodificaAddebito[]>()
    tabella.list.and.returnValues(prima, seconda)
    fixture = TestBed.createComponent(CodificheAddebitoTabComponent)
    await stabilizza(fixture)
    fixture.componentInstance.scegli('CENTRO_RICAVO')
    seconda.next([{ ...gruppo, id: 'c1', genere: 'CENTRO_RICAVO', codice: '010' }])
    prima.next([gruppo])
    await stabilizza(fixture)
    expect(q('codifica-add-riga-010')).not.toBeNull()
    expect(q('codifica-add-riga-001')).toBeNull()
  })

  it('"Nuovo" apre il dialog del genere scelto', async () => {
    await apri()
    fixture.componentInstance.scegli('CATEGORIA')
    await stabilizza(fixture)
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    expect(tabella.prossimoCodice).toHaveBeenCalledWith('CATEGORIA')
    expect(q('codifica-add-nuova')!.textContent).toContain('Nuova')
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('codifica-add-nuova')).toBeNull()
    expect(q('codifica-add-modifica-001')).toBeNull()
    expect(q('codifica-add-attiva-001')).toBeNull()
    expect(q('codifica-add-elimina-001')).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(gruppo)
    await stabilizza(fixture)
    expect(document.body.textContent).toContain('Eliminare il gruppo "001 - Trasporti"?')
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('g1', 1)
  })

  it("409 sull'eliminazione: toast del backend e l'elenco viene riletto", async () => {
    await apri()
    tabella.elimina.and.returnValue(
      throwError(() => ({
        error: { message: 'Il gruppo è in uso: disattivalo invece di eliminarlo.' },
      }))
    )
    fixture.componentInstance.eliminaConfermata(gruppo)
    expect(toast.error).toHaveBeenCalledWith(
      'Il gruppo è in uso: disattivalo invece di eliminarlo.'
    )
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it("errore sul cambio di stato: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.modifica.and.returnValue(throwError(() => ({ error: { message: 'Conflitto.' } })))
    fixture.componentInstance.cambiaStato(gruppo)
    expect(tabella.modifica).toHaveBeenCalledWith('g1', { attiva: false, versione: 1 })
    expect(toast.error).toHaveBeenCalledWith('Conflitto.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })
})
