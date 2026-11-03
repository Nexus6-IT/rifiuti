import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { CodificaAddebitoDialogComponent } from './codifica-addebito-dialog.component'
import { ListinoService } from '../listino.service'
import { CodificaAddebito } from '../listino.model'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import {
  bottone,
  q,
  scrivi,
  stabilizza,
  tabellaFinta,
} from '../../clienti/tabelle/tabelle-test-utils'

const creata: CodificaAddebito = {
  id: 'c9',
  versione: 1,
  eliminabile: true,
  genere: 'CENTRO_RICAVO',
  codice: '004',
  descrizione: 'Smaltimento',
  attiva: true,
}

describe('CodificaAddebitoDialogComponent', () => {
  let tabella: ReturnType<typeof tabellaFinta> & { prossimoCodice: jasmine.Spy }
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<CodificaAddebitoDialogComponent>

  async function apri(
    elemento: CodificaAddebito | null = null,
    opzioni: { rapida?: boolean } = {}
  ) {
    fixture = TestBed.createComponent(CodificaAddebitoDialogComponent)
    fixture.componentRef.setInput('genere', 'CENTRO_RICAVO')
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
      imports: [CodificaAddebitoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { codifiche: tabella } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('"Nuova" propone il codice del genere da prossimoCodice', async () => {
    await apri()
    expect(tabella.prossimoCodice).toHaveBeenCalledWith('CENTRO_RICAVO')
    expect(q<HTMLInputElement>('codifica-add-dlg-codice')!.value).toBe('004')
  })

  it('modalità rapida: un solo campo, senza codice e senza proposta; Invio salva', async () => {
    await apri(null, { rapida: true })
    expect(q('codifica-add-dlg-codice')).toBeNull()
    expect(tabella.prossimoCodice).not.toHaveBeenCalled()
    scrivi('codifica-add-dlg-descrizione', 'Smaltimento')
    await stabilizza(fixture)
    q('codifica-add-dlg-descrizione')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      genere: 'CENTRO_RICAVO',
      descrizione: 'Smaltimento',
    })
  })

  it('rapida: 409 sul codice duplicato chiede di riprovare e lascia aperto', async () => {
    tabella.crea.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'CODIFICA_ADDEBITO_CODICE_DUPLICATO', message: 'Codice già usato.' },
      }))
    )
    await apri(null, { rapida: true })
    scrivi('codifica-add-dlg-descrizione', 'Smaltimento')
    await stabilizza(fixture)
    bottone('codifica-add-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('codifica-add-dlg-errore')!.textContent).toContain('Un collega ha appena usato')
  })

  it('modalità normale: il 409 mostra il messaggio del backend', async () => {
    tabella.crea.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Il codice è già usato.' } }))
    )
    await apri()
    scrivi('codifica-add-dlg-codice', '005')
    scrivi('codifica-add-dlg-descrizione', 'Altro')
    await stabilizza(fixture)
    bottone('codifica-add-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(q('codifica-add-dlg-errore')!.textContent).toContain('Il codice è già usato.')
  })

  it('codice ancora quello proposto: manda null e il toast mostra il codice assegnato', async () => {
    await apri()
    scrivi('codifica-add-dlg-descrizione', 'Smaltimento')
    await stabilizza(fixture)
    bottone('codifica-add-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith({
      genere: 'CENTRO_RICAVO',
      descrizione: 'Smaltimento',
      codice: null,
    })
    expect(toast.success).toHaveBeenCalledWith('Codice assegnato: 004.')
  })

  it("codice cambiato dall'utente: manda quello scritto", async () => {
    await apri()
    scrivi('codifica-add-dlg-codice', '7')
    scrivi('codifica-add-dlg-descrizione', 'Smaltimento')
    await stabilizza(fixture)
    bottone('codifica-add-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.crea).toHaveBeenCalledWith(jasmine.objectContaining({ codice: '7' }))
  })

  it('un codice non numerico o oltre tre cifre blocca Salva', async () => {
    await apri()
    scrivi('codifica-add-dlg-codice', 'AB')
    scrivi('codifica-add-dlg-descrizione', 'Smaltimento')
    await stabilizza(fixture)
    expect(bottone('codifica-add-dlg-salva')!.disabled).toBeTrue()
  })

  it('modifica: manda i valori del form e la versione, senza chiedere un codice', async () => {
    await apri({ ...creata, versione: 5 })
    scrivi('codifica-add-dlg-descrizione', 'Trasporto')
    await stabilizza(fixture)
    bottone('codifica-add-dlg-salva')!.click()
    await stabilizza(fixture)
    expect(tabella.modifica).toHaveBeenCalledWith('c9', {
      codice: '004',
      descrizione: 'Trasporto',
      versione: 5,
    })
    expect(tabella.prossimoCodice).not.toHaveBeenCalled()
  })

  it('senza permesso di scrittura Salva è disabilitato e non scrive', async () => {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'VIEWER' }) } })
    await apri({ ...creata })
    expect(bottone('codifica-add-dlg-salva')!.disabled).toBeTrue()
    fixture.componentInstance.salva()
    expect(tabella.modifica).not.toHaveBeenCalled()
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
    expect(q<HTMLInputElement>('codifica-add-dlg-codice')!.value).toBe('007')
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

  it('modifica: il codice vuoto è rifiutato dal form, senza arrivare al backend', async () => {
    await apri({ ...creata })
    scrivi('codifica-add-dlg-codice', '')
    await stabilizza(fixture)
    expect(fixture.componentInstance.form.controls.codice.valid).toBeFalse()
    expect(bottone('codifica-add-dlg-salva')!.disabled).toBeTrue()
    fixture.componentInstance.salva()
    expect(tabella.modifica).not.toHaveBeenCalled()
  })

  it('nuova: il codice vuoto resta ammesso (lo assegna il server)', async () => {
    await apri()
    scrivi('codifica-add-dlg-codice', '')
    scrivi('codifica-add-dlg-descrizione', 'Nuova voce')
    await stabilizza(fixture)
    expect(fixture.componentInstance.form.valid).toBeTrue()
  })

  it("chiudere durante il salvataggio non emette `salvato` ma `salvatoDopoChiusura` (la scheda rilegge l'elenco)", async () => {
    const risposta$ = new Subject<CodificaAddebito>()
    tabella.crea.and.returnValue(risposta$)
    await apri(null, { rapida: true })
    const salvati: CodificaAddebito[] = []
    const dopoChiusura: CodificaAddebito[] = []
    fixture.componentInstance.salvato.subscribe(v => salvati.push(v))
    fixture.componentInstance.salvatoDopoChiusura.subscribe(v => dopoChiusura.push(v))
    scrivi('codifica-add-dlg-descrizione', 'Nuova voce')
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
    const risposta$ = new Subject<CodificaAddebito>()
    tabella.crea.and.returnValue(risposta$)
    await apri(null, { rapida: true })
    const dopoChiusura: CodificaAddebito[] = []
    fixture.componentInstance.salvatoDopoChiusura.subscribe(v => dopoChiusura.push(v))
    scrivi('codifica-add-dlg-descrizione', 'Nuova voce')
    await stabilizza(fixture)
    fixture.componentInstance.salva()
    fixture.componentInstance.chiudi()
    risposta$.error({ status: 500 })
    expect(dopoChiusura.length).toBe(0)
  })
})
