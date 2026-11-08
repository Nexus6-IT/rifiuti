import { ComponentFixture, TestBed } from '@angular/core/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriCodificheDiagnosticaComponent } from './rentri-codifiche-diagnostica.component'
import {
  RentriCodificheDiagnosticaService,
  DiagnosticaCodifiche,
} from './rentri-codifiche-diagnostica.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

function diagnostica(overrides: Partial<DiagnosticaCodifiche> = {}): DiagnosticaCodifiche {
  return {
    ultimoAllineamento: '2026-07-26T00:00:00.000Z',
    codiciAggiornati: 12,
    codiciNonPresenti: [],
    ...overrides,
  }
}

describe('RentriCodificheDiagnosticaComponent', () => {
  let fixture: ComponentFixture<RentriCodificheDiagnosticaComponent>
  let component: RentriCodificheDiagnosticaComponent
  let service: jasmine.SpyObj<RentriCodificheDiagnosticaService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriCodificheDiagnosticaService>(
      'RentriCodificheDiagnosticaService',
      ['diagnostica', 'allinea']
    )
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])

    TestBed.configureTestingModule({
      imports: [RentriCodificheDiagnosticaComponent],
      providers: [
        { provide: RentriCodificheDiagnosticaService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriCodificheDiagnosticaComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo non admin, senza chiamare il backend', () => {
    setup('OPERATOR')
    fixture.detectChanges()

    expect(component.isAdmin()).toBe(false)
    expect(service.diagnostica).not.toHaveBeenCalled()
    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="rentri-codifiche-allinea-btn"]')).toBeNull()
  })

  it('carica e mostra la diagnostica per un ADMIN, incluso il pulsante "Allinea ora"', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica()))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(service.diagnostica).toHaveBeenCalled()
    expect(html.querySelector('[data-testid="rentri-codifiche-diagnostica"]')).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-codifiche-allinea-btn"]')).not.toBeNull()
    expect(
      html.querySelector('[data-testid="rentri-codifiche-ultimo-allineamento"]')
    ).not.toBeNull()
  })

  it('mai allineato in questo processo: mostra il messaggio dedicato, non un errore', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(
      of(diagnostica({ ultimoAllineamento: null, codiciAggiornati: 0 }))
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(html.querySelector('[data-testid="rentri-codifiche-mai-allineato"]')).not.toBeNull()
  })

  it('elenca i codici CER non più presenti in RENTRI', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(
      of(
        diagnostica({
          codiciNonPresenti: [
            {
              code: '20 03 01',
              description: 'Rifiuti urbani',
              rimossoDaRentriAl: '2026-07-20T00:00:00.000Z',
            },
          ],
        })
      )
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(
      html.querySelector('[data-testid="rentri-codifiche-non-presenti-tabella"]')
    ).not.toBeNull()
    expect(
      html.querySelector('[data-testid="rentri-codifiche-non-presente-20 03 01"]')
    ).not.toBeNull()
  })

  it('"Allinea ora" completato con successo ricarica la diagnostica', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica({ codiciAggiornati: 0 })))
    fixture.detectChanges()

    service.allinea.and.returnValue(of({ eseguito: true }))
    service.diagnostica.and.returnValue(of(diagnostica({ codiciAggiornati: 5 })))

    component.allineaOra()

    expect(service.allinea).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
    expect(component.diagnostica()?.codiciAggiornati).toBe(5)
  })

  it('un 409 (allineamento già in corso) mostra un messaggio "warn", non un errore rosso generico', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica()))
    fixture.detectChanges()

    service.allinea.and.returnValue(
      throwError(() => ({
        status: 409,
        error: {
          message:
            'Un allineamento delle codifiche RENTRI è già in corso: riprova tra qualche minuto.',
        },
      }))
    )

    component.allineaOra()

    expect(toast.warn).toHaveBeenCalledWith(
      'Un allineamento delle codifiche RENTRI è già in corso: riprova tra qualche minuto.'
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('un errore diverso da 409 mostra un errore genuino', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica()))
    fixture.detectChanges()

    service.allinea.and.returnValue(throwError(() => ({ status: 500, error: {} })))

    component.allineaOra()

    expect(toast.error).toHaveBeenCalled()
    expect(toast.warn).not.toHaveBeenCalled()
  })

  it('la pagina ha la larghezza di .page, senza max-width proprio', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica()))
    fixture.detectChanges()

    const pagina = (fixture.nativeElement as HTMLElement).querySelector('.page') as HTMLElement
    expect(pagina).not.toBeNull()
    expect(pagina.getAttribute('style') ?? '').not.toContain('max-width')
    expect(getComputedStyle(pagina).maxWidth).toBe('1320px')
  })
})
