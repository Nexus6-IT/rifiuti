import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import {
  ConfermaEmissioneDialogComponent,
  MSG_EMISSIONE,
  MSG_TRACCIATO_NON_VERIFICATO,
} from './conferma-emissione-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('ConfermaEmissioneDialogComponent', () => {
  let fixture: ComponentFixture<ConfermaEmissioneDialogComponent>
  let comp: ConfermaEmissioneDialogComponent

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfermaEmissioneDialogComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(ConfermaEmissioneDialogComponent)
    comp = fixture.componentInstance
    comp.visible = true
    fixture.detectChanges()
  })

  it('mostra la frase della decisione 12', () => {
    expect(MSG_EMISSIONE).toBe('La fattura diventerà emessa e non si potrà più annullare.')
    expect(q('conferma-emissione-testo')?.textContent).toContain(MSG_EMISSIONE)
  })

  it('conferma ed esce con un evento solo', () => {
    const conferme: number[] = []
    comp.confermato.subscribe(() => conferme.push(1))
    q<HTMLElement>('conferma-emissione-ok')?.querySelector('button')?.click()
    expect(conferme.length).toBe(1)
  })

  it('con la richiesta in corso non conferma e non chiude (doppio clic)', () => {
    const eventi: string[] = []
    comp.confermato.subscribe(() => eventi.push('ok'))
    comp.chiuso.subscribe(() => eventi.push('chiuso'))
    comp.inCorso = true
    comp.conferma()
    comp.chiudi()
    expect(eventi).toEqual([])
  })

  it('mostra avviso ed errore solo se ci sono', () => {
    expect(q('conferma-emissione-avviso')).toBeNull()
    expect(q('conferma-emissione-errore')).toBeNull()
    comp.avviso = MSG_TRACCIATO_NON_VERIFICATO
    comp.errore = 'Qualcosa non va'
    fixture.detectChanges()
    expect(q('conferma-emissione-avviso')?.textContent).toContain(
      "Tracciato non verificato su un'installazione reale"
    )
    expect(q('conferma-emissione-errore')?.textContent).toContain('Qualcosa non va')
  })
})
