import { HttpClientTestingModule } from '@angular/common/http/testing'
import { Component } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { SecondaPesataDialogComponent } from './seconda-pesata-dialog.component'
import { AccessoVista, PeseService, StrumentoPesa } from './pese.service'
import { By } from '@angular/platform-browser'
import { accesso, incolla, q, qb, scegli, scrivi, tasto } from './pese-test-utils'

const strumento: StrumentoPesa = {
  id: 's1',
  registroId: null,
  descrizione: 'Pesa a ponte',
  costruttore: null,
  modello: null,
  matricola: 'M-77',
  portataMaxKg: null,
  divisioneKg: null,
  dataUltimaVerificazione: null,
  attivo: true,
}

@Component({
  standalone: true,
  imports: [SecondaPesataDialogComponent],
  template: `<app-seconda-pesata-dialog
    [accesso]="acc"
    [strumenti]="strumenti"
    (fatto)="fatti.push($event)"
    (chiuso)="chiusi = chiusi + 1"
    (ricarica)="ricaricati = ricaricati + 1"
  ></app-seconda-pesata-dialog>`,
})
class OspiteComponent {
  acc: AccessoVista = accesso({ stato: 'APERTO', pesate: [accesso().pesate[0]] })
  strumenti = [strumento]
  fatti: AccessoVista[] = []
  chiusi = 0
  ricaricati = 0
}

describe('SecondaPesataDialogComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let fixture: ComponentFixture<OspiteComponent>

  const campo = (id: string) => document.getElementById(id) as HTMLInputElement

  /** Compila il form con eventi reali. */
  function compila(peso = '8000') {
    incolla(campo('sp-peso').querySelector('input') ?? campo('sp-peso'), peso)
    scegli(q<HTMLSelectElement>('pm-strumento')!, 's1')
    scrivi(
      q<HTMLTextAreaElement>('pm-motivo')! as unknown as HTMLInputElement,
      'Display illeggibile'
    )
    q<HTMLInputElement>('pm-stabile')!.click()
    fixture.detectChanges()
  }

  beforeEach(() => {
    pese = jasmine.createSpyObj<PeseService>('PeseService', ['secondaPesata'])
    TestBed.configureTestingModule({
      imports: [OspiteComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations(), { provide: PeseService, useValue: pese }],
    })
    fixture = TestBed.createComponent(OspiteComponent)
    fixture.detectChanges()
  })
  afterEach(() => fixture?.destroy())

  it('mostra sempre l avviso che la pesata manuale non ha garanzia metrologica', () => {
    expect(q('pm-avviso')?.textContent).toContain('nessuna garanzia metrologica')
  })

  it('senza i campi obbligatori non invia e segnala ogni mancanza', () => {
    qb('sp-salva')!.click()
    fixture.detectChanges()
    expect(pese.secondaPesata).not.toHaveBeenCalled()
    expect(q('pm-peso-errore')?.textContent).toContain('obbligatorio')
    expect(q('pm-strumento-errore')).not.toBeNull()
    expect(q('pm-motivo-errore')).not.toBeNull()
    expect(q('pm-stabile-errore')).not.toBeNull()
  })

  it('doppio clic su Salva invia una sola richiesta', () => {
    const risposta = new Subject<AccessoVista>()
    pese.secondaPesata.and.returnValue(risposta)
    compila()
    const salva = qb('sp-salva')!
    salva.click()
    fixture.detectChanges()
    expect(qb('sp-salva')!.disabled).toBeTrue()
    qb('sp-salva')!.click()
    salva.click()
    expect(pese.secondaPesata).toHaveBeenCalledTimes(1)
    risposta.next(accesso())
    risposta.complete()
    expect(fixture.componentInstance.fatti.length).toBe(1)
  })

  it('doppio onClick sincrono (che aggira il pulsante disabilitato) invia una sola richiesta', () => {
    pese.secondaPesata.and.returnValue(new Subject<AccessoVista>())
    compila()
    const pulsante = fixture.debugElement.query(By.css('[data-testid="sp-salva"]'))
    pulsante.triggerEventHandler('onClick', {})
    pulsante.triggerEventHandler('onClick', {})
    expect(pese.secondaPesata).toHaveBeenCalledTimes(1)
  })

  it('all apertura il fuoco va sul campo del peso', async () => {
    await new Promise(r => setTimeout(r, 100))
    expect(document.activeElement).toBe(campo('sp-peso'))
  })

  it('un nuovo invio dopo un errore di rete riusa la stessa chiave di idempotenza', () => {
    pese.secondaPesata.and.returnValues(
      throwError(() => ({ status: 0, error: null })),
      of(accesso())
    )
    compila()
    qb('sp-salva')!.click()
    fixture.detectChanges()
    expect(q('sp-errore')).not.toBeNull()
    expect(qb('sp-salva')!.disabled).toBeFalse()
    qb('sp-salva')!.click()
    const [primo, secondo] = pese.secondaPesata.calls.allArgs()
    expect(primo[1].chiaveIdempotenza).toMatch(/^[0-9a-f-]{36}$/)
    expect(secondo[1].chiaveIdempotenza).toBe(primo[1].chiaveIdempotenza)
  })

  it('"1.250" vale 1250 e "12,5" resta 12,5; "12.5" e rifiutato', () => {
    pese.secondaPesata.and.returnValue(of(accesso()))
    compila('1.250')
    qb('sp-salva')!.click()
    expect(pese.secondaPesata.calls.mostRecent().args[1].pesata.pesoKg).toBe(1250)

    fixture.destroy()
    fixture = TestBed.createComponent(OspiteComponent)
    fixture.detectChanges()
    compila('12,5')
    qb('sp-salva')!.click()
    expect(pese.secondaPesata.calls.mostRecent().args[1].pesata.pesoKg).toBe(12.5)

    fixture.destroy()
    fixture = TestBed.createComponent(OspiteComponent)
    fixture.detectChanges()
    const interno = campo('sp-peso').querySelector('input') ?? campo('sp-peso')
    const e = tasto(interno, '.', 'Period')
    fixture.detectChanges()
    expect(e.defaultPrevented).toBeTrue()
    expect(q('pm-peso-errore')?.textContent).toContain('virgola')
  })

  it('invia strumento, motivo, stabilita e ora in ISO di Roma', () => {
    pese.secondaPesata.and.returnValue(of(accesso()))
    compila('8000')
    scrivi(q<HTMLInputElement>('pm-alibi')!, 'AL-1')
    scrivi(q<HTMLInputElement>('pm-data')!, '2026-07-15')
    scrivi(q<HTMLInputElement>('pm-ora')!, '10:30')
    qb('sp-salva')!.click()
    const dati = pese.secondaPesata.calls.mostRecent().args[1].pesata
    expect(dati).toEqual(
      jasmine.objectContaining({
        pesoKg: 8000,
        strumentoId: 's1',
        strumentoEsterno: null,
        alibiId: 'AL-1',
        motivo: 'Display illeggibile',
        stabileDichiarato: true,
        oraStrumento: '2026-07-15T10:30:00+02:00',
      })
    )
  })

  it('strumento esterno: richiede la descrizione e non invia strumentoId', () => {
    pese.secondaPesata.and.returnValue(of(accesso()))
    compila('8000')
    scegli(q<HTMLSelectElement>('pm-strumento')!, '__esterno')
    fixture.detectChanges()
    qb('sp-salva')!.click()
    fixture.detectChanges()
    expect(pese.secondaPesata).not.toHaveBeenCalled()
    expect(q('pm-esterno-errore')).not.toBeNull()
    scrivi(q<HTMLInputElement>('pm-esterno')!, 'Pesa del cliente')
    qb('sp-salva')!.click()
    const dati = pese.secondaPesata.calls.mostRecent().args[1].pesata
    expect(dati.strumentoId).toBeNull()
    expect(dati.strumentoEsterno).toBe('Pesa del cliente')
  })

  it('un 409 si mostra testuale e chiede di rileggere l accesso', () => {
    pese.secondaPesata.and.returnValue(
      throwError(() => ({ status: 409, error: { message: "L'accesso non è più aperto." } }))
    )
    compila()
    qb('sp-salva')!.click()
    fixture.detectChanges()
    expect(q('sp-errore')?.textContent).toContain("L'accesso non è più aperto.")
    expect(q('sp-errore')?.getAttribute('role')).toBe('alert')
    expect(fixture.componentInstance.ricaricati).toBe(1)
  })

  it('un allegato di tipo non ammesso e rifiutato subito con un messaggio italiano', async () => {
    const input = q<HTMLInputElement>('pm-allegato')!
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'nota.txt', { type: 'text/plain' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q('pm-allegato-errore')?.textContent).toContain('JPEG o PNG e documenti PDF')
  })
})
