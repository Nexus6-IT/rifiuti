import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { TestoFatturazioneDialogComponent } from './testo-fatturazione-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { TestoFatturazione } from '../clienti.model'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

const testo: TestoFatturazione = {
  id: 't1',
  versione: 4,
  eliminabile: true,
  codice: 'AB',
  titolo: 'Pagamento',
  righe: ['Prima', 'Seconda'],
  attivo: true,
}

describe('TestoFatturazioneDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<TestoFatturazioneDialogComponent>

  async function apri(elemento: TestoFatturazione | null) {
    fixture = TestBed.createComponent(TestoFatturazioneDialogComponent)
    fixture.componentRef.setInput('elemento', elemento)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    tabella.crea.and.returnValue(of(testo))
    tabella.modifica.and.returnValue(of(testo))
    TestBed.configureTestingModule({
      imports: [TestoFatturazioneDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { testi: tabella } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('fino a 16 righe, contatore dei caratteri a 60', async () => {
    await apri(null)
    expect(q('testo-dlg-riga-0')).not.toBeNull()
    expect(q('testo-dlg-riga-15')).not.toBeNull()
    expect(q('testo-dlg-riga-16')).toBeNull()
    expect(q<HTMLInputElement>('testo-dlg-riga-0')!.maxLength).toBe(60)
    expect(q('testo-dlg-contatore-0')!.textContent).toContain('0/60')
    scrivi('testo-dlg-riga-0', 'abcdefghij')
    await stabilizza(fixture)
    expect(q('testo-dlg-contatore-0')!.textContent).toContain('10/60')
  })

  it('le righe vuote in coda non vengono mandate', async () => {
    await apri(null)
    scrivi('testo-dlg-codice', 'AB')
    scrivi('testo-dlg-titolo', 'Pagamento')
    scrivi('testo-dlg-riga-0', 'Prima')
    scrivi('testo-dlg-riga-1', 'Seconda')
    await stabilizza(fixture)
    bottone('testo-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      codice: 'AB',
      titolo: 'Pagamento',
      righe: ['Prima', 'Seconda'],
    })
  })

  it('modifica: manda i valori del form, non quelli originali', async () => {
    await apri(testo)
    expect(q<HTMLInputElement>('testo-dlg-riga-1')!.value).toBe('Seconda')
    scrivi('testo-dlg-titolo', 'Nuovo titolo')
    scrivi('testo-dlg-riga-1', 'Cambiata')
    await stabilizza(fixture)
    bottone('testo-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith('t1', {
      codice: 'AB',
      titolo: 'Nuovo titolo',
      righe: ['Prima', 'Cambiata'],
      versione: 4,
    })
  })

  it('alla chiusura il form si svuota', async () => {
    await apri(testo)
    fixture.componentInstance.chiudi()
    expect(fixture.componentInstance.form.controls.titolo.value).toBe('')
    expect(fixture.componentInstance.righe.at(0).value).toBe('')
  })
})
