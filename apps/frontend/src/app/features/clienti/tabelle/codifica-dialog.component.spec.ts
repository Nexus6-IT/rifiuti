import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { CodificaDialogComponent } from './codifica-dialog.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { CodificaContratto } from '../clienti.model'
import { AuthService } from '../../../core/services/auth.service'
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
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
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

  const duplicato = () =>
    throwError(() => ({
      status: 409,
      error: { error: 'CODIFICA_CONTRATTO_CODICE_DUPLICATO', message: 'Codice già in uso.' },
    }))

  it('modalità rapida: 409 sul codice duplicato chiede di riprovare e lascia aperto', async () => {
    tabella.crea.and.callFake(duplicato)
    await apri(null, { rapida: true })
    const chiusure: boolean[] = []
    fixture.componentInstance.visibleChange.subscribe(v => chiusure.push(v))
    scrivi('codifica-dlg-descrizione', 'Annuale')
    await stabilizza(fixture)
    bottone('codifica-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('codifica-dlg-errore')!.textContent).toContain(
      'Un collega ha appena usato lo stesso codice: riprova.'
    )
    expect(chiusure).toEqual([])
  })

  it('modalità normale: il 409 mostra il messaggio del backend', async () => {
    tabella.crea.and.callFake(duplicato)
    await apri()
    scrivi('codifica-dlg-descrizione', 'Annuale')
    await stabilizza(fixture)
    bottone('codifica-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('codifica-dlg-errore')!.textContent).toContain('Codice già in uso.')
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

  it('codice ancora quello proposto: manda null e lo assegna il server', async () => {
    await apri()
    scrivi('codifica-dlg-descrizione', 'Annuale')
    await stabilizza(fixture)
    bottone('codifica-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      genere: 'TIPO',
      descrizione: 'Annuale',
      codice: null,
    })
  })

  it("codice cambiato dall'utente: manda quello scritto", async () => {
    await apri()
    scrivi('codifica-dlg-codice', '009')
    scrivi('codifica-dlg-descrizione', 'Annuale')
    await stabilizza(fixture)
    bottone('codifica-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      genere: 'TIPO',
      descrizione: 'Annuale',
      codice: '009',
    })
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

  it("chiudere durante il salvataggio non emette `salvato` ma `salvatoDopoChiusura` (la scheda rilegge l'elenco)", async () => {
    const risposta$ = new Subject<CodificaContratto>()
    tabella.crea.and.returnValue(risposta$)
    await apri(null, { rapida: true })
    const salvati: CodificaContratto[] = []
    const dopoChiusura: CodificaContratto[] = []
    fixture.componentInstance.salvato.subscribe(v => salvati.push(v))
    fixture.componentInstance.salvatoDopoChiusura.subscribe(v => dopoChiusura.push(v))
    scrivi('codifica-dlg-descrizione', 'Nuova voce')
    await stabilizza(fixture)
    fixture.componentInstance.salva()
    expect(fixture.componentInstance.inCorso()).toBeTrue()
    fixture.componentInstance.chiudi()
    expect(fixture.componentInstance.inCorso()).toBeFalse()
    risposta$.next(creata)
    expect(salvati.length).toBe(0)
    expect(dopoChiusura).toEqual([creata])
  })

  it('un errore dopo la chiusura non emette nulla', async () => {
    const risposta$ = new Subject<CodificaContratto>()
    tabella.crea.and.returnValue(risposta$)
    await apri(null, { rapida: true })
    const dopoChiusura: CodificaContratto[] = []
    fixture.componentInstance.salvatoDopoChiusura.subscribe(v => dopoChiusura.push(v))
    scrivi('codifica-dlg-descrizione', 'Nuova voce')
    await stabilizza(fixture)
    fixture.componentInstance.salva()
    fixture.componentInstance.chiudi()
    risposta$.error({ status: 500 })
    expect(dopoChiusura.length).toBe(0)
  })

  it('senza ruolo di scrittura Salva è disattivato e salva() non chiama il servizio', async () => {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'VIEWER' }) } })
    await apri(null, { rapida: true })
    scrivi('codifica-dlg-descrizione', 'Nuova voce')
    await stabilizza(fixture)
    expect(bottone('codifica-dlg-salva')!.disabled).toBeTrue()
    fixture.componentInstance.salva()
    expect(tabella.crea).not.toHaveBeenCalled()
  })
})
