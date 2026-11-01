import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of } from 'rxjs'
import { CodificaDialogComponent } from './codifica-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CodificaContratto } from '../clienti.model'
import { ToastService } from '../../../core/services/toast.service'
import { bottone, q, scrivi, stabilizza, tabellaFinta } from './tabelle-test-utils'

const creata: CodificaContratto = {
  id: 'c9',
  versione: 1,
  eliminabile: true,
  genere: 'TIPO',
  codice: '004',
  descrizione: 'Annuale',
  attiva: true,
}

describe('CodificaDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta> & { prossimoCodice: jasmine.Spy }
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CodificaDialogComponent>

  async function apri(
    elemento: CodificaContratto | null = null,
    opzioni: { rapida?: boolean } = {}
  ) {
    fixture = TestBed.createComponent(CodificaDialogComponent)
    fixture.componentRef.setInput('genere', 'TIPO')
    fixture.componentRef.setInput('elemento', elemento)
    fixture.componentRef.setInput('rapida', opzioni.rapida ?? false)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    tabella = Object.assign(tabellaFinta(), {
      prossimoCodice: jasmine.createSpy('prossimoCodice').and.returnValue(of('004')),
    })
    tabella.crea.and.returnValue(of(creata))
    tabella.modifica.and.returnValue(of(creata))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [CodificaDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { codifiche: tabella } },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('"Nuova" propone il codice da prossimoCodice', async () => {
    await apri()
    expect(tabella.prossimoCodice).toHaveBeenCalledWith('TIPO')
    expect(q<HTMLInputElement>('codifica-dlg-codice')!.value).toBe('004')
  })

  it('modalità rapida: un campo, Invio salva', async () => {
    await apri(null, { rapida: true })
    expect(q('codifica-dlg-codice')).toBeNull()
    expect(tabella.prossimoCodice).not.toHaveBeenCalled()
    scrivi('codifica-dlg-descrizione', 'Annuale')
    await stabilizza(fixture)
    q('codifica-dlg-descrizione')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledOnceWith({ genere: 'TIPO', descrizione: 'Annuale' })
  })

  it('codice lasciato vuoto: assegnato dal server e mostrato nel toast', async () => {
    await apri()
    scrivi('codifica-dlg-codice', '')
    scrivi('codifica-dlg-descrizione', 'Annuale')
    await stabilizza(fixture)
    bottone('codifica-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      genere: 'TIPO',
      descrizione: 'Annuale',
      codice: null,
    })
    expect(toast.success).toHaveBeenCalledWith(jasmine.stringContaining('004'))
  })

  it('modifica: manda i valori del form e la versione', async () => {
    await apri({ ...creata, versione: 5 })
    scrivi('codifica-dlg-descrizione', 'Biennale')
    await stabilizza(fixture)
    bottone('codifica-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith('c9', {
      codice: '004',
      descrizione: 'Biennale',
      versione: 5,
    })
    expect(tabella.prossimoCodice).not.toHaveBeenCalled()
  })

  it("un codice proposto in ritardo da un'apertura precedente non sovrascrive quello corrente", async () => {
    const prima = new Subject<string>()
    const seconda = new Subject<string>()
    tabella.prossimoCodice.and.returnValues(prima, seconda)
    await apri()
    fixture.componentRef.setInput('visible', false)
    await stabilizza(fixture)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    seconda.next('007')
    prima.next('005')
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('codifica-dlg-codice')!.value).toBe('007')
  })

  it('un codice proposto dopo la chiusura non riempie il form', async () => {
    const lento = new Subject<string>()
    tabella.prossimoCodice.and.returnValue(lento)
    await apri()
    fixture.componentInstance.chiudi()
    lento.next('009')
    expect(fixture.componentInstance.form.controls.codice.value).toBe('')
  })

  it('alla chiusura il form si svuota', async () => {
    await apri(creata)
    fixture.componentInstance.chiudi()
    expect(fixture.componentInstance.form.controls.descrizione.value).toBe('')
  })
})
