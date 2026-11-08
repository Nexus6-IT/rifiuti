import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriSitiComponent } from './rentri-siti.component'
import { RentriSitiService, RentriSito } from './rentri-siti.service'
import { RentriCredentialService, RentriCredentialStatus } from './rentri-credential.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

function sito(overrides: Partial<RentriSito> = {}): RentriSito {
  return {
    id: 'ul-1',
    numIscrSito: 'OP1234ABC123456-RM1234',
    denominazione: 'Sede principale',
    principale: true,
    attiva: true,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function credenzialeConfigurata(
  overrides: Partial<RentriCredentialStatus> = {}
): RentriCredentialStatus {
  return { configured: true, numIscrOperatore: 'OP1234ABC123456', ...overrides }
}

describe('RentriSitiComponent', () => {
  let fixture: ComponentFixture<RentriSitiComponent>
  let component: RentriSitiComponent
  let sitiService: jasmine.SpyObj<RentriSitiService>
  let credentialService: jasmine.SpyObj<RentriCredentialService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    sitiService = jasmine.createSpyObj<RentriSitiService>('RentriSitiService', ['list', 'aggiorna'])
    credentialService = jasmine.createSpyObj<RentriCredentialService>('RentriCredentialService', [
      'getStatus',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])

    TestBed.configureTestingModule({
      imports: [RentriSitiComponent, RouterTestingModule],
      providers: [
        { provide: RentriSitiService, useValue: sitiService },
        { provide: RentriCredentialService, useValue: credentialService },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriSitiComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo non admin, senza chiamare il backend', () => {
    setup('OPERATOR')
    fixture.detectChanges()

    expect(component.isAdmin()).toBe(false)
    expect(credentialService.getStatus).not.toHaveBeenCalled()
    expect(sitiService.list).not.toHaveBeenCalled()
  })

  it('senza numIscrOperatore configurato mostra il messaggio con il link, non una tabella vuota silenziosa', () => {
    setup('ADMIN')
    credentialService.getStatus.and.returnValue(
      of(credenzialeConfigurata({ numIscrOperatore: null }))
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(component.numIscrOperatoreConfigurato()).toBe(false)
    expect(sitiService.list).not.toHaveBeenCalled()
    expect(html.querySelector('[data-testid="rentri-siti-non-configurato"]')).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-siti-configura-link"]')).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-siti-tabella"]')).toBeNull()
  })

  it('con numIscrOperatore configurato carica ed elenca le unità locali dalla cache', () => {
    setup('ADMIN')
    credentialService.getStatus.and.returnValue(of(credenzialeConfigurata()))
    sitiService.list.and.returnValue(of([sito()]))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(sitiService.list).toHaveBeenCalled()
    expect(component.sedi()).toEqual([sito()])
    expect(html.querySelector('[data-testid="rentri-siti-tabella"]')).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-siti-aggiorna-btn"]')).not.toBeNull()
  })

  it('il pulsante "Aggiorna dall\'ente" forza la rilettura e sostituisce l’elenco', () => {
    setup('ADMIN')
    credentialService.getStatus.and.returnValue(of(credenzialeConfigurata()))
    sitiService.list.and.returnValue(of([sito()]))
    fixture.detectChanges()

    const aggiornata = sito({ denominazione: 'Sede aggiornata' })
    sitiService.aggiorna.and.returnValue(of([aggiornata]))

    component.aggiornaDaEnte()

    expect(sitiService.aggiorna).toHaveBeenCalled()
    expect(component.sedi()).toEqual([aggiornata])
    expect(toast.success).toHaveBeenCalled()
  })

  it('un errore di allineamento (es. fail-closed numIscrOperatore mancante) mostra il messaggio del backend', () => {
    setup('ADMIN')
    credentialService.getStatus.and.returnValue(of(credenzialeConfigurata()))
    sitiService.list.and.returnValue(of([]))
    fixture.detectChanges()

    sitiService.aggiorna.and.returnValue(
      throwError(() => ({ error: { message: 'Configura il numero di iscrizione RENTRI...' } }))
    )

    component.aggiornaDaEnte()

    expect(toast.error).toHaveBeenCalledWith('Configura il numero di iscrizione RENTRI...')
  })

  it('la pagina ha la larghezza di .page, senza max-width proprio', () => {
    setup('ADMIN')
    credentialService.getStatus.and.returnValue(of(credenzialeConfigurata()))
    sitiService.list.and.returnValue(of([sito()]))
    fixture.detectChanges()

    const pagina = (fixture.nativeElement as HTMLElement).querySelector('.page') as HTMLElement
    expect(pagina).not.toBeNull()
    expect(pagina.getAttribute('style') ?? '').not.toContain('max-width')
    expect(getComputedStyle(pagina).maxWidth).toBe('1320px')
  })
})
