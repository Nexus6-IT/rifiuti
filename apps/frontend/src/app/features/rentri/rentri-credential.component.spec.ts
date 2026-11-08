import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { of } from 'rxjs'
import { RentriCredentialComponent } from './rentri-credential.component'
import { RentriCredentialService } from './rentri-credential.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

describe('RentriCredentialComponent', () => {
  let fixture: ComponentFixture<RentriCredentialComponent>
  let credentialService: jasmine.SpyObj<RentriCredentialService>

  beforeEach(() => {
    credentialService = jasmine.createSpyObj<RentriCredentialService>('RentriCredentialService', [
      'getStatus',
      'setCredential',
      'remove',
    ])
    credentialService.getStatus.and.returnValue(
      of({ configured: true, clientId: 'c1', environment: 'demo', algorithm: 'ES256' })
    )

    TestBed.configureTestingModule({
      imports: [RentriCredentialComponent, RouterTestingModule],
      providers: [
        { provide: RentriCredentialService, useValue: credentialService },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'u1', email: 'u@test.com', role: 'ADMIN' }) },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']),
        },
        ConfirmationService,
      ],
    })
    fixture = TestBed.createComponent(RentriCredentialComponent)
    fixture.detectChanges()
  })

  it("il selettore dell'algoritmo non c'è più", () => {
    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('#r-algo')).toBeNull()
    expect(html.querySelector('[ariaLabel="Algoritmo di firma"]')).toBeNull()
  })

  it("l'algoritmo ricavato dalla chiave si mostra in sola lettura", () => {
    const el = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="rentri-credential-algoritmo"]'
    )
    expect(el?.textContent).toContain('ES256')
  })

  it('il payload di salvataggio non contiene algorithm', () => {
    credentialService.setCredential.and.returnValue(of({ success: true, algorithm: 'ES256' }))
    const c = fixture.componentInstance
    c.clientId = 'c1'
    c.mode = 'pem'
    c.certificatePem = 'cert'
    c.privateKeyPem = 'key'

    c.save()

    expect(credentialService.setCredential.calls.mostRecent().args[0]).not.toEqual(
      jasmine.objectContaining({ algorithm: jasmine.anything() })
    )
  })

  it('la pagina ha la larghezza di .page, senza max-width proprio', () => {
    const pagina = (fixture.nativeElement as HTMLElement).querySelector('.page') as HTMLElement
    expect(pagina).not.toBeNull()
    expect(pagina.getAttribute('style') ?? '').not.toContain('max-width')
    expect(getComputedStyle(pagina).maxWidth).toBe('1320px')
  })

  it("il toast di salvataggio non cita l'algoritmo e il modulo ha una larghezza di lettura", () => {
    credentialService.setCredential.and.returnValue(of({ success: true, algorithm: 'ES256' }))
    const toast = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>
    const c = fixture.componentInstance
    c.clientId = 'c1'
    c.mode = 'pem'
    c.certificatePem = 'cert'
    c.privateKeyPem = 'key'
    c.save()
    fixture.detectChanges()

    expect(toast.success).toHaveBeenCalledWith('Certificato RENTRI salvato')
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '.rentri-modulo .field'
    ) as HTMLElement
    expect(getComputedStyle(campo).maxWidth).toBe('640px')
    const pem = (fixture.nativeElement as HTMLElement).querySelector('#r-pem-cert') as HTMLElement
    expect(pem).not.toBeNull()
    expect(getComputedStyle(pem).maxWidth).not.toBe('none')
  })
})
