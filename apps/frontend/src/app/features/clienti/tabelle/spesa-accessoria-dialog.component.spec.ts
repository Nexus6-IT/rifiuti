import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { SpesaAccessoriaDialogComponent } from './spesa-accessoria-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

describe('SpesaAccessoriaDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<SpesaAccessoriaDialogComponent>

  async function apri(tipo?: 'BOLLO' | 'INCASSO') {
    fixture = TestBed.createComponent(SpesaAccessoriaDialogComponent)
    fixture.componentRef.setInput('elemento', null)
    if (tipo) fixture.componentRef.setInput('tipo', tipo)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    tabella.crea.and.returnValue(of({ id: 's1' }))
    TestBed.configureTestingModule({
      imports: [SpesaAccessoriaDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { spese: tabella } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('dialog aperto con tipo fissato: tipo non modificabile', async () => {
    await apri('BOLLO')
    expect(q('spesa-dlg-tipo-fisso')!.textContent).toContain('Bollo')
    expect(q('spesa-dlg-tipo')).toBeNull()
    scrivi('spesa-dlg-codice', 'B1')
    scrivi('spesa-dlg-descrizione', 'Bollo virtuale')
    scrivi('spesa-dlg-importo', '2')
    await stabilizza(fixture)
    bottone('spesa-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: 'BOLLO' }))
  })

  it('importo mandato come stringa col punto', async () => {
    await apri()
    scrivi('spesa-dlg-codice', 'I1')
    scrivi('spesa-dlg-descrizione', 'Incasso')
    scrivi('spesa-dlg-importo', '2,50')
    await stabilizza(fixture)
    bottone('spesa-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      tipo: 'INCASSO',
      codice: 'I1',
      descrizione: 'Incasso',
      importo: '2.50',
    })
  })

  it('modifica senza tipo fissato: il tipo scelto viene mandato', async () => {
    tabella.modifica.and.returnValue(of({ id: 's1' }))
    fixture = TestBed.createComponent(SpesaAccessoriaDialogComponent)
    fixture.componentRef.setInput('elemento', {
      id: 's1',
      versione: 2,
      eliminabile: true,
      tipo: 'INCASSO',
      codice: 'I1',
      descrizione: 'Incasso',
      importo: '2.00',
      attiva: true,
    })
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    fixture.componentInstance.form.controls.tipo.setValue('BOLLO')
    await stabilizza(fixture)
    bottone('spesa-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith(
      's1',
      jasmine.objectContaining({ tipo: 'BOLLO', versione: 2 })
    )
  })

  describe('importo: la virgola è obbligatoria (decisione di Graziano)', () => {
    const compila = async (importo: string) => {
      await apri()
      scrivi('spesa-dlg-codice', 'I1')
      scrivi('spesa-dlg-descrizione', 'Incasso')
      scrivi('spesa-dlg-importo', importo)
      await stabilizza(fixture)
    }

    it('"1.000" è rifiutato: errore sul campo, salvataggio bloccato', async () => {
      await compila('1.000')
      expect(q('spesa-dlg-importo-errore')!.textContent).toContain('Usa la virgola per i decimali')
      expect(q('spesa-dlg-importo')!.getAttribute('aria-describedby')).toBe('spesa-importo-errore')
      expect(bottone('spesa-dlg-salva')!.disabled).toBeTrue()
      fixture.componentInstance.salva()
      expect(tabella.crea).not.toHaveBeenCalled()
    })

    it('"1000,5" parte come "1000.5"', async () => {
      await compila('1000,5')
      expect(q('spesa-dlg-importo-errore')).toBeNull()
      bottone('spesa-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(tabella.crea).toHaveBeenCalledWith(jasmine.objectContaining({ importo: '1000.5' }))
    })

    it('alla riapertura 1000.00 si legge "1000", senza separatore delle migliaia', async () => {
      fixture = TestBed.createComponent(SpesaAccessoriaDialogComponent)
      fixture.componentRef.setInput('elemento', {
        id: 's1',
        versione: 1,
        eliminabile: true,
        tipo: 'INCASSO',
        codice: 'I1',
        descrizione: 'Incasso',
        importo: '1000.00',
        attiva: true,
      })
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      expect((q('spesa-dlg-importo') as HTMLInputElement).value).toBe('1000')
    })
  })
})
