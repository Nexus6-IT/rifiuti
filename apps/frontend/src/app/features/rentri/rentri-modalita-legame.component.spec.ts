import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriModalitaLegameComponent } from './rentri-modalita-legame.component'
import { RentriModalitaLegameService } from './rentri-modalita-legame.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

describe('RentriModalitaLegameComponent', () => {
  let fixture: ComponentFixture<RentriModalitaLegameComponent>
  let component: RentriModalitaLegameComponent
  let service: jasmine.SpyObj<RentriModalitaLegameService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriModalitaLegameService>('RentriModalitaLegameService', [
      'getStatus',
      'setModalita',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])

    TestBed.configureTestingModule({
      imports: [RentriModalitaLegameComponent, RouterTestingModule],
      providers: [
        { provide: RentriModalitaLegameService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriModalitaLegameComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo non admin, senza chiamare il backend', () => {
    setup('OPERATOR')
    fixture.detectChanges()

    expect(component.isAdmin()).toBe(false)
    expect(service.getStatus).not.toHaveBeenCalled()
  })

  it('carica lo stato per un ADMIN e disabilita AUTOMATICA/IBRIDA senza certificato', () => {
    setup('ADMIN')
    service.getStatus.and.returnValue(
      of({ modalitaLegame: 'MANUALE', certificatoConfigurato: false })
    )

    fixture.detectChanges()

    expect(service.getStatus).toHaveBeenCalled()
    expect(component.isDisabled('AUTOMATICA')).toBe(true)
    expect(component.isDisabled('IBRIDA')).toBe(true)
    expect(component.isDisabled('MANUALE')).toBe(false)
  })

  it('non disabilita AUTOMATICA/IBRIDA quando il certificato è configurato', () => {
    setup('SUPER_ADMIN')
    service.getStatus.and.returnValue(
      of({ modalitaLegame: 'MANUALE', certificatoConfigurato: true })
    )

    fixture.detectChanges()

    expect(component.isDisabled('AUTOMATICA')).toBe(false)
    expect(component.isDisabled('IBRIDA')).toBe(false)
  })

  it("ignora la selezione di un'opzione disabilitata (niente aggancio senza certificato)", () => {
    setup('ADMIN')
    service.getStatus.and.returnValue(
      of({ modalitaLegame: 'MANUALE', certificatoConfigurato: false })
    )
    fixture.detectChanges()

    component.onSelect('AUTOMATICA')

    expect(component.selected()).toBe('MANUALE')
  })

  it('salva la nuova modalità selezionata e aggiorna lo stato', () => {
    setup('ADMIN')
    service.getStatus.and.returnValue(
      of({ modalitaLegame: 'MANUALE', certificatoConfigurato: true })
    )
    fixture.detectChanges()

    service.setModalita.and.returnValue(
      of({ modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true })
    )
    component.onSelect('AUTOMATICA')
    component.save()

    expect(service.setModalita).toHaveBeenCalledWith('AUTOMATICA')
    expect(component.status()?.modalitaLegame).toBe('AUTOMATICA')
    expect(toast.success).toHaveBeenCalled()
  })

  it('mostra un errore se il salvataggio fallisce (es. 400 senza certificato)', () => {
    setup('ADMIN')
    service.getStatus.and.returnValue(
      of({ modalitaLegame: 'MANUALE', certificatoConfigurato: true })
    )
    fixture.detectChanges()

    service.setModalita.and.returnValue(
      throwError(() => ({ error: { message: 'Serve un certificato configurato' } }))
    )
    component.onSelect('AUTOMATICA')
    component.save()

    expect(toast.error).toHaveBeenCalledWith('Serve un certificato configurato')
  })
})
