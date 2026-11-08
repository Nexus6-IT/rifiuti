import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ActivatedRoute, provideRouter } from '@angular/router'
import { Type } from '@angular/core'
import { MessageService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { LoginComponent } from './login.component'
import { AuthCallbackComponent } from './auth-callback.component'
import { SpidLoginComponent } from './spid-login/spid-login.component'
import { SpidCallbackComponent } from './spid-callback/spid-callback.component'

const authStub = {
  login: () => ({ subscribe: () => undefined }),
  loginWithSPID: () => undefined,
  loginWithCIE: () => undefined,
  completeSpidLogin: () => ({ subscribe: () => undefined }),
  handleCallback: () => ({ subscribe: () => undefined }),
}

function crea<T>(tipo: Type<T>): ComponentFixture<T> {
  TestBed.configureTestingModule({
    imports: [tipo],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: AuthService, useValue: authStub },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
    ],
  })
  const fixture = TestBed.createComponent(tipo)
  fixture.detectChanges()
  document.body.appendChild(fixture.nativeElement)
  return fixture
}

describe('LoginComponent (restyle «Libro mastro»)', () => {
  let el: HTMLElement
  let fixture: ComponentFixture<LoginComponent>

  beforeEach(() => {
    fixture = crea(LoginComponent)
    el = fixture.nativeElement
  })
  afterEach(() => fixture.nativeElement.remove())

  it('non cita la Pubblica Amministrazione né la conformità garantita', () => {
    const testo = el.textContent ?? ''
    expect(testo).not.toContain('Pubblica Amministrazione')
    expect(testo).not.toContain('garantita')
  })

  it('mostra i testi approvati del pannello', () => {
    const testo = (el.textContent ?? '').replace(/\s+/g, ' ')
    expect(testo).toContain('Formulari, registro e RENTRI in un solo posto')
    expect(testo).toContain(
      'Il gestionale per le aziende che producono, trasportano e recuperano rifiuti.'
    )
    expect(testo).toContain('FIR digitali e trasmissione a RENTRI')
    expect(testo).toContain('Registro di carico e scarico sempre allineato')
    expect(testo).toContain("MUD preparato dai dati dell'anno")
    expect(testo).toContain('WasteFlow · IgniCraft')
    expect(testo).toContain('Gestione digitale dei rifiuti')
  })

  it('usa il segno del marchio e nessuna icona in riquadro nell elenco', () => {
    expect(el.querySelector('.auth__brand app-segno-marchio')).not.toBeNull()
    expect(el.querySelectorAll('.brand-list i').length).toBe(0)
  })

  it('il pannello è piatto, senza sfumature', () => {
    const pannello = el.querySelector('.auth__brand') as HTMLElement
    const stile = getComputedStyle(pannello)
    expect(stile.backgroundImage).toBe('none')
    const dopo = getComputedStyle(pannello, '::after')
    expect(dopo.backgroundImage).toBe('none')
  })

  it('nel pannello nessun testo è in maiuscolo forzato', () => {
    const pannello = el.querySelector('.auth__brand') as HTMLElement
    const maiuscoli = [pannello, ...Array.from(pannello.querySelectorAll<HTMLElement>('*'))].filter(
      e => getComputedStyle(e).textTransform === 'uppercase'
    )
    expect(maiuscoli.length).toBe(0)
  })

  it("«Accedi» è l'unico bottone primario (.wf-primario)", () => {
    const primari = el.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(primari[0].textContent).toContain('Accedi')
  })

  it('il pannello è separato dal form da un bordo', () => {
    const pannello = el.querySelector('.auth__brand') as HTMLElement
    expect(getComputedStyle(pannello).borderInlineEndWidth).toBe('1px')
  })

  it('mantiene il bottone «Accedi»', () => {
    const bottone = el.querySelector('p-button button') as HTMLButtonElement
    expect(bottone.textContent).toContain('Accedi')
  })
})

describe('pagine di callback e SPID: sfondo piatto', () => {
  const tipi: Array<[string, Type<unknown>]> = [
    ['AuthCallbackComponent', AuthCallbackComponent],
    ['SpidLoginComponent', SpidLoginComponent],
    ['SpidCallbackComponent', SpidCallbackComponent],
  ]
  for (const [nome, tipo] of tipi) {
    it(`${nome} non ha gradient nello stile calcolato`, () => {
      const fixture = crea(tipo)
      const tutti = [fixture.nativeElement as HTMLElement].concat(
        Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('*'))
      )
      const conGradiente = tutti.filter(e =>
        getComputedStyle(e).backgroundImage.includes('gradient')
      )
      fixture.nativeElement.remove()
      expect(conGradiente.length).toBe(0)
    })
  }
})
