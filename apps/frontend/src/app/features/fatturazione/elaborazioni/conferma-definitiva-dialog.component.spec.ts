import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import {
  ConfermaDefinitivaDialogComponent,
  RiepilogoConferma,
  testoConferma,
} from './conferma-definitiva-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

const riepilogo: RiepilogoConferma = {
  documenti: 28,
  registri: [{ codice: 'A', da: '15/A', a: '42/A' }],
  dataDocumento: '2026-11-03',
}

describe('testoConferma', () => {
  it('«Verranno emessi N documenti, numeri da X a Y del registro R, data gg/mm/aaaa»', () => {
    expect(testoConferma(riepilogo)).toBe(
      'Verranno emessi 28 documenti, numeri da 15/A a 42/A del registro A, data 03/11/2026.'
    )
  })

  it('un solo documento: singolare', () => {
    expect(
      testoConferma({
        documenti: 1,
        registri: [{ codice: 'A', da: '7/A', a: '7/A' }],
        dataDocumento: '2026-11-03',
      })
    ).toBe('Verrà emesso 1 documento, numero 7/A del registro A, data 03/11/2026.')
  })

  it('più registri: un intervallo per registro', () => {
    expect(
      testoConferma({
        documenti: 5,
        registri: [
          { codice: 'A', da: '1/A', a: '3/A' },
          { codice: 'B', da: '1', a: '2' },
        ],
        dataDocumento: '2026-11-03',
      })
    ).toBe(
      'Verranno emessi 5 documenti, numeri da 1/A a 3/A del registro A, da 1 a 2 del registro B, data 03/11/2026.'
    )
  })

  it('senza il conteggio non lo inventa', () => {
    expect(testoConferma({ ...riepilogo, documenti: null })).toBe(
      'Verranno emessi i documenti, numeri da 15/A a 42/A del registro A, data 03/11/2026.'
    )
  })
})

describe('ConfermaDefinitivaDialogComponent', () => {
  let fixture: ComponentFixture<ConfermaDefinitivaDialogComponent>
  let confermato: jasmine.Spy
  let chiuso: jasmine.Spy

  async function crea(inCorso = false): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ConfermaDefinitivaDialogComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(ConfermaDefinitivaDialogComponent)
    confermato = jasmine.createSpy('confermato')
    chiuso = jasmine.createSpy('chiuso')
    fixture.componentInstance.confermato.subscribe(confermato)
    fixture.componentInstance.chiuso.subscribe(chiuso)
    fixture.componentRef.setInput('visible', true)
    fixture.componentRef.setInput('riepilogo', riepilogo)
    fixture.componentRef.setInput('inCorso', inCorso)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('mostra il testo di conferma e conferma con il pulsante', async () => {
    await crea()
    expect(q('conferma-testo')!.textContent).toContain(
      'Verranno emessi 28 documenti, numeri da 15/A a 42/A del registro A, data 03/11/2026.'
    )
    expect(document.body.textContent).toContain(
      'I numeri sono previsti: vengono assegnati in modo definitivo alla conferma.'
    )
    q<HTMLButtonElement>('conferma-ok')!.querySelector('button')!.click()
    expect(confermato).toHaveBeenCalledTimes(1)
  })

  it('«Annulla» chiude senza confermare', async () => {
    await crea()
    q('conferma-annulla')!.querySelector('button')!.click()
    expect(chiuso).toHaveBeenCalledTimes(1)
    expect(confermato).not.toHaveBeenCalled()
  })

  it('durante la richiesta i pulsanti sono disattivati (niente doppio clic)', async () => {
    await crea(true)
    expect(q('conferma-ok')!.querySelector('button')!.disabled).toBeTrue()
    expect(q('conferma-annulla')!.querySelector('button')!.disabled).toBeTrue()
  })
})
