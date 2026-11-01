import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ContoCorrenteDialogComponent } from './conto-corrente-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ContoCorrente, ContoCorrenteInElenco } from '../clienti.model'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

const IBAN = 'IT60X0542811101000000123456'
const inElenco: ContoCorrenteInElenco = {
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

describe('ContoCorrenteDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta>
  let fixture: ComponentFixture<ContoCorrenteDialogComponent>

  async function apri(elemento: ContoCorrenteInElenco | null) {
    fixture = TestBed.createComponent(ContoCorrenteDialogComponent)
    fixture.componentRef.setInput('elemento', elemento)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = tabellaFinta()
    TestBed.configureTestingModule({
      imports: [ContoCorrenteDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { conti: tabella } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("modifica: carica il dettaglio e mostra l'IBAN intero", async () => {
    const dettaglio: ContoCorrente = { ...inElenco, iban: IBAN }
    tabella.get.and.returnValue(of(dettaglio))
    await apri(inElenco)
    expect(tabella.get).toHaveBeenCalledWith('k1')
    expect(q<HTMLInputElement>('conto-dlg-iban')!.value).toBe(IBAN)
  })

  it('409 IBAN duplicato: messaggio nel dialog', async () => {
    tabella.crea.and.returnValue(
      throwError(() => ({
        error: { code: 'IBAN_DUPLICATO', message: 'Esiste già un conto con questo IBAN.' },
      }))
    )
    await apri(null)
    scrivi('conto-dlg-codice', 'BP')
    scrivi('conto-dlg-descrizione', 'Principale')
    scrivi('conto-dlg-banca', 'Banca')
    scrivi('conto-dlg-iban', IBAN)
    await stabilizza(fixture)
    bottone('conto-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('conto-dlg-errore')!.textContent).toContain('Esiste già un conto')
    expect(tabella.crea).toHaveBeenCalledWith(jasmine.objectContaining({ iban: IBAN, bic: null }))
  })
})
