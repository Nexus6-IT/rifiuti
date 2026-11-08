import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { CodiciIvaTabComponent } from './codici-iva-tab.component'
import { ListinoService } from '../listino.service'
import { CodiceIva } from '../listino.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import {
  accettaConferma,
  bottone,
  q,
  scrivi,
  stabilizza,
  tabellaFinta,
} from '../../clienti/tabelle/tabelle-test-utils'
import { apriMenuRiga, chiudiMenuRiga } from '../../clienti/tabelle/azioni-test-utils'

const iva22: CodiceIva = {
  id: '7f3b2c9e-iva1-4d5a-9b1e-0c2d3e4f5a6b',
  versione: 1,
  eliminabile: true,
  codice: '22',
  descrizione: 'Ordinaria',
  aliquota: '22.00',
  natura: null,
  attivo: true,
}
const n61: CodiceIva = {
  ...iva22,
  id: 'i2',
  codice: 'N61',
  descrizione: 'Inversione contabile',
  aliquota: '0.00',
  natura: 'N6.1',
  eliminabile: false,
}

describe('CodiciIvaTabComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CodiciIvaTabComponent>

  async function apri(role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(CodiciIvaTabComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    tabella.list.and.returnValue(of([iva22, n61]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [CodiciIvaTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { codiciIva: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("elenco con le disattivate: codice, aliquota e natura; l'id non si vede", async () => {
    await apri()
    expect(tabella.list).toHaveBeenCalledWith({ incluseDisattivate: true })
    expect(q('iva-riga-22')!.textContent).toContain('22.00%')
    expect(q('iva-riga-N61')!.textContent).toContain('N6.1')
    expect(document.body.textContent).not.toContain('7f3b2c9e-iva1-4d5a-9b1e-0c2d3e4f5a6b')
  })

  it('nuovo: crea con aliquota stringa e ricarica', async () => {
    tabella.crea.and.returnValue(of(iva22))
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    scrivi('iva-dlg-codice', '22')
    scrivi('iva-dlg-descrizione', 'Ordinaria')
    scrivi('iva-dlg-aliquota', '22,00')
    await stabilizza(fixture)
    bottone('iva-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      codice: '22',
      descrizione: 'Ordinaria',
      aliquota: '22.00',
      natura: null,
    })
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it('modifica: manda i valori del form e la versione', async () => {
    tabella.modifica.and.returnValue(of(n61))
    await apri()
    fixture.componentInstance.apri(n61)
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('iva-dlg-aliquota')!.value).toBe('0,00')
    scrivi('iva-dlg-descrizione', 'Inversione')
    await stabilizza(fixture)
    bottone('iva-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith('i2', {
      codice: 'N61',
      descrizione: 'Inversione',
      aliquota: '0.00',
      natura: 'N6.1',
      versione: 1,
    })
  })

  it('409 al salvataggio: il messaggio del backend resta nel dialog', async () => {
    tabella.crea.and.returnValue(
      throwError(() => ({ error: { message: 'Esiste già un codice IVA con questo codice.' } }))
    )
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    scrivi('iva-dlg-codice', '22')
    scrivi('iva-dlg-descrizione', 'Ordinaria')
    scrivi('iva-dlg-aliquota', '22')
    await stabilizza(fixture)
    bottone('iva-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('iva-dlg-errore')!.textContent).toContain('Esiste già un codice IVA')
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('iva-nuovo')).toBeNull()
    expect(
      document.body.querySelector('[data-testid="azione-principale"], [data-testid="azioni-altre"]')
    ).toBeNull()
  })

  it('"Elimina" solo se eliminabile; conferma e poi manda id e versione', async () => {
    await apri()
    expect(await apriMenuRiga(fixture, q('iva-riga-N61')!)).not.toContain('Elimina')
    chiudiMenuRiga()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(iva22)
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('7f3b2c9e-iva1-4d5a-9b1e-0c2d3e4f5a6b', 1)
  })

  it("409 sull'eliminazione: toast col messaggio del backend e l'elenco viene riletto", async () => {
    await apri()
    tabella.elimina.and.returnValue(
      throwError(() => ({
        error: {
          message:
            "Il codice IVA è usato da addebiti dell'archivio: disattivalo invece di eliminarlo.",
        },
      }))
    )
    fixture.componentInstance.eliminaConfermata(iva22)
    expect(toast.error).toHaveBeenCalledWith(
      "Il codice IVA è usato da addebiti dell'archivio: disattivalo invece di eliminarlo."
    )
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it("errore sul cambio di stato: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.modifica.and.returnValue(throwError(() => ({ error: { message: 'Conflitto.' } })))
    fixture.componentInstance.cambiaStato(iva22)
    expect(tabella.modifica).toHaveBeenCalledWith('7f3b2c9e-iva1-4d5a-9b1e-0c2d3e4f5a6b', {
      attivo: false,
      versione: 1,
    })
    expect(toast.error).toHaveBeenCalledWith('Conflitto.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it("errore sull'elenco: messaggio del backend", async () => {
    tabella.list.and.returnValue(throwError(() => ({ error: { message: 'Non autorizzato.' } })))
    await apri()
    expect(document.body.textContent).toContain('Non autorizzato.')
  })
})
