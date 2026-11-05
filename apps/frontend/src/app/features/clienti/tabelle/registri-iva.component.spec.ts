import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RegistriIvaComponent } from './registri-iva.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { RegistroIva } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { accettaConferma, bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

const registro: RegistroIva = {
  id: 'r1',
  versione: 1,
  eliminabile: true,
  codice: '01',
  descrizione: 'Vendite',
  ricevuteSplit: false,
  attivo: true,
  suffissoNumero: null,
  suffissoModificabile: true,
}
const split: RegistroIva = { ...registro, id: 'r2', codice: '02', ricevuteSplit: true }

describe('RegistriIvaComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RegistriIvaComponent>

  async function apri(role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(RegistriIvaComponent)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    tabella.list.and.returnValue(of([registro, split]))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [RegistriIvaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { registri: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('badge "Ricevute split" solo sul registro delle ricevute split', async () => {
    await apri()
    expect(q('registro-riga-02')!.textContent).toContain('Ricevute split')
    expect(q('registro-riga-01')!.textContent).not.toContain('Ricevute split')
  })

  it('il codice mostrato dopo il salvataggio è quello restituito dal server', async () => {
    tabella.list.and.returnValues(of([]), of([{ ...registro, codice: '01' }]))
    tabella.crea.and.returnValue(of({ ...registro, codice: '01' }))
    await apri()
    fixture.componentInstance.apri(null)
    await stabilizza(fixture)
    scrivi('registro-dlg-codice', '1')
    scrivi('registro-dlg-descrizione', 'Vendite')
    await stabilizza(fixture)
    bottone('registro-dlg-salva')!.click()
    await stabilizza(fixture)
    // Il frontend manda quel che è stato scritto: il completamento è del server.
    expect(tabella.crea).toHaveBeenCalledWith(jasmine.objectContaining({ codice: '1' }))
    expect(q('registro-riga-01')).not.toBeNull()
  })

  it('VIEWER: nessun pulsante di scrittura', async () => {
    await apri('VIEWER')
    expect(q('registro-nuovo')).toBeNull()
    expect(q('registro-modifica-01')).toBeNull()
    expect(q('registro-attivo-01')).toBeNull()
    expect(q('registro-elimina-01')).toBeNull()
  })

  it('elimina: conferma e poi manda id e versione', async () => {
    await apri()
    tabella.elimina.and.returnValue(of(undefined))
    fixture.componentInstance.elimina(registro)
    await stabilizza(fixture)
    accettaConferma()
    await stabilizza(fixture)
    expect(tabella.elimina).toHaveBeenCalledWith('r1', 1)
  })

  it("errore sull'eliminazione: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.elimina.and.returnValue(
      throwError(() => ({ error: { message: 'Il registro è in uso.' } }))
    )
    fixture.componentInstance.eliminaConfermata(registro)
    expect(toast.error).toHaveBeenCalledWith('Il registro è in uso.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })

  it("errore sul cambio di stato: toast e l'elenco viene riletto", async () => {
    await apri()
    tabella.modifica.and.returnValue(throwError(() => ({ error: { message: 'Conflitto.' } })))
    fixture.componentInstance.cambiaStato(registro)
    expect(tabella.modifica).toHaveBeenCalledWith('r1', { attivo: false, versione: 1 })
    expect(toast.error).toHaveBeenCalledWith('Conflitto.')
    expect(tabella.list).toHaveBeenCalledTimes(2)
  })
})
