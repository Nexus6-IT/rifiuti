import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriDiagnosticaComponent } from './rentri-diagnostica.component'
import { RentriDiagnosticaService, RentriDiagnostica } from './rentri-diagnostica.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

function diagnostica(overrides: Partial<RentriDiagnostica> = {}): RentriDiagnostica {
  return {
    certificato: {
      configurato: true,
      scadenza: '2027-01-01T00:00:00.000Z',
      giorniAllaScadenza: 100,
      livelloAvviso: 'ok',
    },
    trasmissioniRecenti: [],
    formulariAttenzione: [],
    limitatore: { volumeCorrente: 0, concorrenzaCorrente: 0, inAttesa: false },
    ...overrides,
  }
}

describe('RentriDiagnosticaComponent', () => {
  let fixture: ComponentFixture<RentriDiagnosticaComponent>
  let component: RentriDiagnosticaComponent
  let service: jasmine.SpyObj<RentriDiagnosticaService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriDiagnosticaService>('RentriDiagnosticaService', [
      'diagnostica',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])

    TestBed.configureTestingModule({
      imports: [RentriDiagnosticaComponent],
      providers: [
        { provide: RentriDiagnosticaService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriDiagnosticaComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo senza visibilità RENTRI, senza chiamare il backend', () => {
    setup('CLIENTE_LIMITATO')
    fixture.detectChanges()

    expect(component.isAutorizzato()).toBe(false)
    expect(service.diagnostica).not.toHaveBeenCalled()
    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="rentri-diagnostica-non-autorizzato"]')).not.toBeNull()
  })

  it('carica e mostra la diagnostica per OPERATOR (coerente con i ruoli backend R1)', () => {
    setup('OPERATOR')
    service.diagnostica.and.returnValue(of(diagnostica()))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(service.diagnostica).toHaveBeenCalledTimes(1)
    expect(
      html.querySelector('[data-testid="rentri-diagnostica-certificato-scadenza"]')
    ).not.toBeNull()
    expect(
      html.querySelector('[data-testid="rentri-diagnostica-trasmissioni-recenti"]')
    ).not.toBeNull()
    expect(
      html.querySelector('[data-testid="rentri-diagnostica-formulari-attenzione"]')
    ).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-diagnostica-limitatore-stato"]')).not.toBeNull()
  })

  it('mostra il messaggio del limitatore quando il tenant sta attendendo capacità', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(
      of(
        diagnostica({ limitatore: { volumeCorrente: 30, concorrenzaCorrente: 1, inAttesa: true } })
      )
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(
      html.querySelector('[data-testid="rentri-diagnostica-limitatore-in-attesa"]')
    ).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-diagnostica-limitatore-normale"]')).toBeNull()
  })

  it('elenca i formulari che richiedono attenzione', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(
      of(
        diagnostica({
          formulariAttenzione: [
            {
              firId: 'fir-1',
              firNumber: 'FIR-0001',
              motivo: 'PERMANENTLY_FAILED',
              dettaglio: 'errore di validazione',
            },
          ],
        })
      )
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(
      html.querySelector('[data-testid="rentri-diagnostica-formulario-attenzione-fir-1"]')
    ).not.toBeNull()
  })

  it('"Aggiorna" è un\'azione esplicita: ricarica la diagnostica quando cliccato', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica({ trasmissioniRecenti: [] })))
    fixture.detectChanges()

    service.diagnostica.and.returnValue(
      of(
        diagnostica({
          trasmissioniRecenti: [
            {
              id: 'log-1',
              firId: 'fir-1',
              firNumber: 'FIR-0001',
              status: 'SUCCESS',
              attempt: 1,
              errorCode: null,
              errorMessage: null,
              createdAt: '2026-07-26T10:00:00.000Z',
            },
          ],
        })
      )
    )

    component.aggiorna()

    expect(service.diagnostica).toHaveBeenCalledTimes(2)
    expect(component.diagnostica()?.trasmissioniRecenti.length).toBe(1)
  })

  it('un errore di rete durante "Aggiorna" mostra un messaggio, senza far esplodere il componente', () => {
    setup('ADMIN')
    service.diagnostica.and.returnValue(of(diagnostica()))
    fixture.detectChanges()

    service.diagnostica.and.returnValue(throwError(() => ({ status: 500 })))
    component.aggiorna()

    expect(toast.error).toHaveBeenCalled()
  })

  describe('nessun polling automatico (vincolo del piano R5 Task 3, Step 4)', () => {
    it('NON pianifica alcun setInterval verso il servizio di diagnostica al montaggio', () => {
      setup('ADMIN')
      service.diagnostica.and.returnValue(of(diagnostica()))
      const setIntervalSpy = spyOn(window, 'setInterval').and.callThrough()

      fixture.detectChanges()

      expect(setIntervalSpy).not.toHaveBeenCalled()
    })

    it('il numero di chiamate al backend NON cresce con il tempo senza interazione utente', fakeAsync(() => {
      setup('ADMIN')
      service.diagnostica.and.returnValue(of(diagnostica()))

      fixture.detectChanges()
      expect(service.diagnostica).toHaveBeenCalledTimes(1)

      // Trascorre un tempo ampiamente superiore a qualunque intervallo di
      // polling ragionevole: se un timer fosse stato piazzato per errore, qui
      // si vedrebbe una seconda chiamata senza che l'utente abbia fatto nulla.
      tick(10 * 60 * 1000)

      expect(service.diagnostica).toHaveBeenCalledTimes(1)
    }))
  })
})
