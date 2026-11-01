import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RegistroIvaDialogComponent } from './registro-iva-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { RegistroIva } from '../clienti.model'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

const registro: RegistroIva = {
  id: 'r1',
  versione: 3,
  eliminabile: true,
  codice: '01',
  descrizione: 'Vendite',
  ricevuteSplit: false,
  attivo: true,
}

describe('RegistroIvaDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<RegistroIvaDialogComponent>

  async function apri(elemento: RegistroIva | null) {
    fixture = TestBed.createComponent(RegistroIvaDialogComponent)
    fixture.componentRef.setInput('elemento', elemento)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    TestBed.configureTestingModule({
      imports: [RegistroIvaDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { registri: tabella } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('modifica: manda i valori del form e la versione', async () => {
    tabella.modifica.and.returnValue(of(registro))
    await apri(registro)
    scrivi('registro-dlg-descrizione', 'Vendite estero')
    await stabilizza(fixture)
    bottone('registro-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith('r1', {
      codice: '01',
      descrizione: 'Vendite estero',
      ricevuteSplit: false,
      versione: 3,
    })
  })

  it('errore del server: messaggio nel dialog', async () => {
    tabella.crea.and.returnValue(
      throwError(() => ({ error: { message: 'Esiste già un registro con questo codice.' } }))
    )
    await apri(null)
    scrivi('registro-dlg-codice', '01')
    scrivi('registro-dlg-descrizione', 'Vendite')
    await stabilizza(fixture)
    bottone('registro-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('registro-dlg-errore')!.textContent).toContain('Esiste già un registro')
  })

  it('alla chiusura il form si svuota', async () => {
    await apri(registro)
    fixture.componentInstance.chiudi()
    expect(fixture.componentInstance.form.controls.descrizione.value).toBe('')
  })
})
