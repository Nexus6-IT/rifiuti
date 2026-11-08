import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { provideHttpClient } from '@angular/common/http'
import { provideHttpClientTesting } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { AccessRequestComponent } from './signup.component'

describe('AccessRequestComponent (restyle «Libro mastro»)', () => {
  let fixture: ComponentFixture<AccessRequestComponent>
  let el: HTMLElement

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AccessRequestComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    })
    fixture = TestBed.createComponent(AccessRequestComponent)
    fixture.detectChanges()
    el = fixture.nativeElement
    document.body.appendChild(el)
  })
  afterEach(() => el.remove())

  it('non cita la Pubblica Amministrazione né la conformità garantita', () => {
    const testo = el.textContent ?? ''
    expect(testo).not.toContain('Pubblica Amministrazione')
    expect(testo).not.toContain('garantita')
  })

  it('il pannello usa i testi approvati e non più quelli del consulente', () => {
    const testo = (el.textContent ?? '').replace(/\s+/g, ' ')
    expect(testo).toContain('Formulari, registro e RENTRI in un solo posto')
    expect(testo).toContain(
      'Il gestionale per le aziende che producono, trasportano e recuperano rifiuti.'
    )
    expect(testo).toContain('FIR digitali e trasmissione a RENTRI')
    expect(testo).toContain('Registro di carico e scarico sempre allineato')
    expect(testo).toContain("MUD preparato dai dati dell'anno")
    expect(testo).toContain('WasteFlow · IgniCraft')
    expect(testo).not.toContain('Scopri WasteFlow con un consulente dedicato')
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Richiedi accesso')
  })

  it('le etichette sono in sentence case', () => {
    const testo = el.textContent ?? ''
    expect(testo).toContain('Prova guidata')
    expect(testo).toContain('Dati azienda')
    expect(testo).toContain('Referente')
  })

  it('il pannello è piatto e senza icone in riquadro', () => {
    const pannello = el.querySelector('.auth__brand') as HTMLElement
    expect(getComputedStyle(pannello).backgroundImage).toBe('none')
    expect(getComputedStyle(pannello, '::after').backgroundImage).toBe('none')
    expect(pannello.querySelectorAll('.brand-list i').length).toBe(0)
    expect(pannello.querySelector('app-segno-marchio')).not.toBeNull()
  })

  it('nessun elemento è in maiuscolo forzato (pannello e intestazioni del form)', () => {
    const tutti = Array.from(el.querySelectorAll<HTMLElement>('*'))
    const maiuscoli = tutti.filter(e => getComputedStyle(e).textTransform === 'uppercase')
    expect(maiuscoli.map(e => e.className)).toEqual([])
  })

  it("«Invia richiesta» è l'unico bottone primario (.wf-primario)", () => {
    const primari = el.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(primari[0].textContent).toContain('Invia richiesta')
  })

  it('sotto i 992px il pannello di marca si nasconde (a 768px il titolo andrebbe su tre righe)', () => {
    const regole: CSSMediaRule[] = []
    for (const foglio of Array.from(document.styleSheets)) {
      try {
        for (const r of Array.from(foglio.cssRules)) {
          if (r instanceof CSSMediaRule && /max-width:\s*991\.98px/.test(r.conditionText)) {
            if (
              Array.from(r.cssRules).some(c =>
                (c as CSSStyleRule).selectorText?.includes('auth__brand')
              )
            ) {
              regole.push(r)
            }
          }
        }
      } catch {
        /* foglio di un'altra origine */
      }
    }
    expect(regole.length).toBeGreaterThan(0)
  })

  it('il pannello è separato dal form da un bordo', () => {
    const pannello = el.querySelector('.auth__brand') as HTMLElement
    expect(getComputedStyle(pannello).borderInlineEndWidth).toBe('1px')
  })
})
