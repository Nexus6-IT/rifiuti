import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriUnitaLocaleComponent } from './rentri-unita-locale.component'
import { RentriUnitaLocaleService, RentriUnitaLocale } from './rentri-unita-locale.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

function sede(overrides: Partial<RentriUnitaLocale> = {}): RentriUnitaLocale {
  return {
    id: 'ul-1',
    numIscrSito: 'OP1234ABC123456-RM1234',
    denominazione: 'Sede principale',
    principale: true,
    attiva: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('RentriUnitaLocaleComponent', () => {
  let fixture: ComponentFixture<RentriUnitaLocaleComponent>
  let component: RentriUnitaLocaleComponent
  let service: jasmine.SpyObj<RentriUnitaLocaleService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriUnitaLocaleService>('RentriUnitaLocaleService', [
      'list',
      'create',
      'update',
      'setPrincipale',
      'remove',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])

    TestBed.configureTestingModule({
      imports: [RentriUnitaLocaleComponent, RouterTestingModule],
      providers: [
        { provide: RentriUnitaLocaleService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriUnitaLocaleComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo non admin, senza chiamare il backend', () => {
    setup('OPERATOR')
    fixture.detectChanges()

    expect(component.isAdmin()).toBe(false)
    expect(service.list).not.toHaveBeenCalled()
  })

  it('carica le sedi per un ADMIN', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede()]))

    fixture.detectChanges()

    expect(service.list).toHaveBeenCalled()
    expect(component.sedi()).toEqual([sede()])
  })

  it('con una sola sede non propone alcuna scelta di "sede principale" (costo pagato solo da chi ne ha bisogno)', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede()]))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(html.querySelector('[data-testid="rentri-unita-locale-set-principale-ul-1"]')).toBeNull()
    // Anche nel form di aggiunta: con zero sedi esistenti non c'è nulla da
    // scegliere. Con UNA sede esistente, invece, la checkbox compare (la
    // scelta serve solo alla seconda sede in poi).
  })

  it('con due o più sedi mostra il selettore "rendi principale" per quella non principale', () => {
    setup('ADMIN')
    service.list.and.returnValue(
      of([sede(), sede({ id: 'ul-2', principale: false, denominazione: 'Sede secondaria' })])
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(
      html.querySelector('[data-testid="rentri-unita-locale-set-principale-ul-2"]')
    ).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-unita-locale-set-principale-ul-1"]')).toBeNull()
  })

  it('crea la primissima sede senza inviare "principale" (il backend la forza comunque a true)', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([]))
    fixture.detectChanges()

    service.create.and.returnValue(of(sede()))
    component.denominazione = 'Sede principale'
    component.numIscrSito = 'OP1234ABC123456-RM1234'
    component.create()

    expect(service.create).toHaveBeenCalledWith({
      denominazione: 'Sede principale',
      numIscrSito: 'OP1234ABC123456-RM1234',
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('crea una seconda sede includendo la scelta esplicita di "principale"', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede()]))
    fixture.detectChanges()

    service.create.and.returnValue(
      of(sede({ id: 'ul-2', principale: true, denominazione: 'Sede secondaria' }))
    )
    component.denominazione = 'Sede secondaria'
    component.numIscrSito = 'OP5678DEF987654-TO5678'
    component.nuovaSedePrincipale = true
    component.create()

    expect(service.create).toHaveBeenCalledWith({
      denominazione: 'Sede secondaria',
      numIscrSito: 'OP5678DEF987654-TO5678',
      principale: true,
    })
  })

  it("imposta una sede come principale e ricarica l'elenco", () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede(), sede({ id: 'ul-2', principale: false })]))
    fixture.detectChanges()

    service.setPrincipale.and.returnValue(of(sede({ id: 'ul-2', principale: true })))
    component.setPrincipale(sede({ id: 'ul-2', principale: false }))

    expect(service.setPrincipale).toHaveBeenCalledWith('ul-2')
    expect(toast.success).toHaveBeenCalled()
  })

  it('mostra un errore quando il backend rifiuta la cancellazione della sede principale', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede(), sede({ id: 'ul-2', principale: false })]))
    fixture.detectChanges()

    service.remove.and.returnValue(
      throwError(() => ({ error: { message: "Imposta prima un'altra sede come principale" } }))
    )
    component['remove'](sede())

    expect(toast.error).toHaveBeenCalledWith("Imposta prima un'altra sede come principale")
  })
})
