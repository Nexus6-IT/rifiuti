import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { CodiceIva } from '../../listino/listino.model'
import { ListinoService } from '../../listino/listino.service'
import { SpesaAccessoriaDialogComponent } from './spesa-accessoria-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

const iva = (id: string, codice: string, natura: string | null): CodiceIva => ({
  id,
  versione: 1,
  eliminabile: true,
  codice,
  descrizione: `Codice ${codice}`,
  aliquota: natura ? '0.00' : '22.00',
  natura,
  attivo: true,
})

describe('SpesaAccessoriaDialogComponent', () => {
  let codiciIva: jasmine.Spy
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
    codiciIva = jasmine
      .createSpy('list')
      .and.returnValue(of([iva('i22', '22', null), iva('in1', 'N1', 'N1')]))
    TestBed.configureTestingModule({
      imports: [SpesaAccessoriaDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { spese: tabella } },
        { provide: ListinoService, useValue: { codiciIva: { list: codiciIva } } },
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
      codiceIvaId: null,
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

  describe('codice IVA', () => {
    const compila = async (tipo?: 'BOLLO' | 'INCASSO') => {
      await apri(tipo)
      scrivi('spesa-dlg-codice', 'X1')
      scrivi('spesa-dlg-descrizione', 'Spesa')
      scrivi('spesa-dlg-importo', '2')
      await stabilizza(fixture)
    }
    const salva = async () => {
      bottone('spesa-dlg-salva')!.click()
      await stabilizza(fixture)
    }

    it('il menu offre i codici attivi (lista senza incluseDisattivate)', async () => {
      await apri()
      expect(codiciIva).toHaveBeenCalledWith()
      expect(fixture.componentInstance.opzioniIva().map(o => o.etichetta)).toEqual([
        '22 - Codice 22',
        'N1 - Codice N1',
      ])
      // Dal template: il menu aperto mostra le stesse voci.
      q('spesa-dlg-codice-iva')!.querySelector<HTMLElement>('.p-dropdown')!.click()
      await stabilizza(fixture)
      const voci = Array.from(document.body.querySelectorAll('.p-dropdown-item')).map(e =>
        e.textContent?.trim()
      )
      expect(voci).toEqual(['22 - Codice 22', 'N1 - Codice N1'])
    })

    it('scelto: salvato nel corpo', async () => {
      await compila()
      fixture.componentInstance.form.controls.codiceIvaId.setValue('i22')
      await stabilizza(fixture)
      await salva()
      expect(tabella.crea).toHaveBeenCalledWith(jasmine.objectContaining({ codiceIvaId: 'i22' }))
    })

    it('vuoto: il corpo ha null', async () => {
      await compila()
      await salva()
      expect(tabella.crea.calls.mostRecent().args[0].codiceIvaId).toBeNull()
    })

    it('modifica: il codice della spesa è preselezionato, anche se ora disattivato', async () => {
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
        codiceIvaId: 'vecchio',
      })
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      expect(fixture.componentInstance.opzioniIva().some(o => o.id === 'vecchio')).toBeTrue()
      await salva()
      expect(tabella.modifica).toHaveBeenCalledWith(
        's1',
        jasmine.objectContaining({ codiceIvaId: 'vecchio' })
      )
    })

    it('bollo senza codice IVA N1: suggerimento; sparisce scegliendo N1', async () => {
      await apri('BOLLO')
      const testo = 'Per addebitare il bollo serve un codice IVA con natura N1'
      expect(q('spesa-dlg-suggerimento-bollo')!.textContent).toContain(testo)
      fixture.componentInstance.form.controls.codiceIvaId.setValue('i22')
      await stabilizza(fixture)
      expect(q('spesa-dlg-suggerimento-bollo')).not.toBeNull()
      fixture.componentInstance.form.controls.codiceIvaId.setValue('in1')
      await stabilizza(fixture)
      expect(q('spesa-dlg-suggerimento-bollo')).toBeNull()
    })

    it('incasso: nessun suggerimento sul bollo', async () => {
      await apri('INCASSO')
      expect(q('spesa-dlg-suggerimento-bollo')).toBeNull()
    })
  })
})
