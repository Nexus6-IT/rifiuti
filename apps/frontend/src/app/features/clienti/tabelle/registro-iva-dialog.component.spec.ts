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
  suffissoNumero: null,
  suffissoModificabile: true,
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
      suffissoNumero: null,
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

  describe('suffisso del numero', () => {
    const input = () => q<HTMLInputElement>('registro-dlg-suffisso')!

    it('modificabile: scritto e mandato', async () => {
      tabella.modifica.and.returnValue(of(registro))
      await apri({ ...registro, suffissoNumero: '/A' })
      expect(input().value).toBe('/A')
      expect(input().disabled).toBeFalse()
      scrivi('registro-dlg-suffisso', '/B')
      await stabilizza(fixture)
      bottone('registro-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(tabella.modifica.calls.mostRecent().args[1].suffissoNumero).toBe('/B')
    })

    it('svuotato: il corpo ha null', async () => {
      tabella.modifica.and.returnValue(of(registro))
      await apri({ ...registro, suffissoNumero: '/A' })
      scrivi('registro-dlg-suffisso', '')
      await stabilizza(fixture)
      bottone('registro-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(tabella.modifica.calls.mostRecent().args[1].suffissoNumero).toBeNull()
    })

    it('non modificabile: campo disabilitato, tooltip col motivo, non viene mandato', async () => {
      tabella.modifica.and.returnValue(of(registro))
      await apri({ ...registro, suffissoNumero: '/A', suffissoModificabile: false })
      expect(input().disabled).toBeTrue()
      expect(input().value).toBe('/A')
      expect(q('registro-dlg-suffisso-box')!.getAttribute('title')).toContain('fatture definitive')
      expect(q('registro-dlg-suffisso-motivo')!.textContent).toContain('fatture definitive')
      bottone('registro-dlg-salva')!.click()
      await stabilizza(fixture)
      expect('suffissoNumero' in tabella.modifica.calls.mostRecent().args[1]).toBeFalse()
    })

    it('un registro nuovo ha il suffisso libero', async () => {
      await apri(null)
      expect(input().disabled).toBeFalse()
      expect(q('registro-dlg-suffisso-box')!.getAttribute('title')).toBeNull()
    })

    for (const errato of ['/A B', '12345678901', 'à']) {
      it(`"${errato}" è rifiutato: errore sul campo e salvataggio bloccato`, async () => {
        await apri(null)
        scrivi('registro-dlg-codice', '01')
        scrivi('registro-dlg-descrizione', 'Vendite')
        scrivi('registro-dlg-suffisso', errato)
        await stabilizza(fixture)
        expect(q('registro-dlg-suffisso-errore')).not.toBeNull()
        expect(bottone('registro-dlg-salva')!.disabled).toBeTrue()
      })
    }

    it('409 SUFFISSO_NON_MODIFICABILE: messaggio del backend nel dialog', async () => {
      tabella.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: {
            error: 'SUFFISSO_NON_MODIFICABILE',
            message: "Il suffisso non si può cambiare: ci sono fatture definitive nell'anno.",
          },
        }))
      )
      await apri(registro)
      scrivi('registro-dlg-suffisso', '/C')
      await stabilizza(fixture)
      bottone('registro-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('registro-dlg-errore')!.textContent).toContain('Il suffisso non si può cambiare')
    })
  })
})
