import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RentriRegistroImpostazioniDialogComponent } from './rentri-registro-impostazioni-dialog.component'
import { ImpostazioniRegistroRentri, RentriRegistroService } from './rentri-registro.service'
import { ToastService } from '../../core/services/toast.service'

function registro(p: Partial<ImpostazioniRegistroRentri> = {}): ImpostazioniRegistroRentri {
  return {
    registroId: 'r1',
    descrizione: 'Sede',
    identificativoRentri: null,
    invioAutomatico: false,
    invioAutomaticoDal: null,
    perStato: {},
    nonTrasmessi: 0,
    haCertificato: true,
    ...p,
  }
}

const q = <T extends HTMLElement = HTMLElement>(testid: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testid}"]`)

function scrivi(testid: string, valore: string): void {
  const el = q<HTMLInputElement>(testid)!
  el.value = valore
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('RentriRegistroImpostazioniDialogComponent', () => {
  let servizio: jasmine.SpyObj<RentriRegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RentriRegistroImpostazioniDialogComponent>

  function apri(r: ImpostazioniRegistroRentri): void {
    fixture = TestBed.createComponent(RentriRegistroImpostazioniDialogComponent)
    fixture.componentRef.setInput('registro', r)
    fixture.componentRef.setInput('annoCorrente', 2026)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RentriRegistroService>('RentriRegistroService', [
      'imposta',
      'dichiaraGiaSuRentri',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RentriRegistroImpostazioniDialogComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RentriRegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('rifiuta un identificativo nel formato sbagliato senza chiamare il backend', () => {
    apri(registro())
    scrivi('rentri-imp-identificativo', 'abc')
    q<HTMLButtonElement>('rentri-imp-salva')!.querySelector('button')!.click()
    fixture.detectChanges()
    expect(servizio.imposta).not.toHaveBeenCalled()
    expect(q('rentri-imp-identificativo-err')?.textContent).toContain('R seguita da 10')
    expect(q('rentri-imp-identificativo')!.getAttribute('aria-describedby')).toContain(
      'rentri-imp-identificativo-err'
    )
  })

  it("salva identificativo e invio automatico; il testo dell'interruttore dice che lo storico non parte", () => {
    servizio.imposta.and.returnValue(of(registro()))
    apri(registro())
    expect(q('rentri-imp-auto-nota')?.textContent).toContain('storico')
    scrivi('rentri-imp-identificativo', ' rabcde12345 ')
    q<HTMLInputElement>('rentri-imp-auto')!.click()
    fixture.detectChanges()
    q<HTMLButtonElement>('rentri-imp-salva')!.querySelector('button')!.click()
    expect(servizio.imposta).toHaveBeenCalledWith('r1', {
      identificativoRentri: 'RABCDE12345',
      invioAutomatico: true,
    })
  })

  it("l'invio automatico non si attiva senza identificativo", () => {
    apri(registro())
    expect(q<HTMLInputElement>('rentri-imp-auto')!.disabled).toBeTrue()
  })

  it('mostra verbatim il 409 del backend come messaggio nel dialog', () => {
    const msg = 'Il registro ha già annotazioni trasmesse con questo identificativo.'
    servizio.imposta.and.returnValue(throwError(() => ({ status: 409, error: { message: msg } })))
    apri(registro({ identificativoRentri: 'RABCDE12345' }))
    scrivi('rentri-imp-identificativo', 'RZZZZZ99999')
    q<HTMLButtonElement>('rentri-imp-salva')!.querySelector('button')!.click()
    fixture.detectChanges()
    const e = q('rentri-imp-errore')
    expect(e?.textContent).toContain(msg)
    expect(e?.getAttribute('role')).toBe('alert')
  })

  it('dichiara già su RENTRI solo dopo conferma che dice quante annotazioni', () => {
    servizio.dichiaraGiaSuRentri.and.returnValue(
      of({ dichiarate: 5, saltate: 0, saltatePerStato: {}, movimentiNellIntervallo: 5 })
    )
    apri(registro({ identificativoRentri: 'RABCDE12345' }))
    scrivi('rentri-dic-da', '1')
    scrivi('rentri-dic-a', '5')
    scrivi('rentri-dic-motivo', 'Già trasmessi dal programma precedente')
    fixture.detectChanges()
    q('rentri-dic-avvia')!.querySelector('button')!.click()
    fixture.detectChanges()
    expect(servizio.dichiaraGiaSuRentri).not.toHaveBeenCalled()
    expect(q('rentri-dic-conferma')?.textContent).toContain('5 annotazioni')
    q('rentri-dic-conferma-si')!.querySelector('button')!.click()
    expect(servizio.dichiaraGiaSuRentri).toHaveBeenCalledWith({
      registroId: 'r1',
      anno: 2026,
      daProgressivo: 1,
      aProgressivo: 5,
      motivo: 'Già trasmessi dal programma precedente',
    })
  })

  it('Esc chiude il dialog', async () => {
    apri(registro())
    await fixture.whenStable()
    fixture.detectChanges()
    let chiuso = false
    fixture.componentInstance.visibleChange.subscribe((v: boolean) => (chiuso = !v))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(chiuso).toBeTrue()
  })
})
