import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { EsitoGenerazioneDialogComponent } from './esito-generazione-dialog.component'
import { ritiroDiProva } from './ritiri-test-utils'

const q = (id: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('EsitoGenerazioneDialogComponent', () => {
  let fixture: ComponentFixture<EsitoGenerazioneDialogComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EsitoGenerazioneDialogComponent],
      providers: [provideNoopAnimations(), provideRouter([])],
    }).compileComponents()
    fixture = TestBed.createComponent(EsitoGenerazioneDialogComponent)
    fixture.componentInstance.ritiri = [ritiroDiProva({ id: 'r1' }), ritiroDiProva({ id: 'r2' })]
    fixture.componentInstance.esiti = [
      { ritiroId: 'r1', esito: 'CREATO', firId: 'f1' },
      { ritiroId: 'r2', esito: 'ERRORE', codice: 'CER_NON_VALIDO' },
      { ritiroId: 'r3', esito: 'GIA_GENERATO', firId: 'f3' },
    ]
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  })

  it('riassume gli esiti e mostra una riga per ritiro', () => {
    expect(q('eg-riepilogo')?.textContent).toContain('1 bozze create, 1 già generate, 1 con errore')
    expect(document.body.querySelectorAll('[data-testid^="eg-riga-"]').length).toBe(3)
  })

  it('l’errore mostra la frase del codice, mai l’id', () => {
    const riga = q('eg-riga-r2')!.textContent ?? ''
    expect(riga).toContain('Errore')
    expect(riga).toContain('codice CER non è valido')
    expect(riga).not.toContain('r2')
  })

  it('collega la bozza del FIR creato', () => {
    const a = q('eg-fir-r1') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/fir/f1')
  })

  it('Chiudi emette chiuso', () => {
    let chiuso = false
    fixture.componentInstance.chiuso.subscribe(() => (chiuso = true))
    ;(q('eg-chiudi')!.querySelector('button') ?? (q('eg-chiudi') as HTMLElement)).click()
    expect(chiuso).toBeTrue()
  })
})
