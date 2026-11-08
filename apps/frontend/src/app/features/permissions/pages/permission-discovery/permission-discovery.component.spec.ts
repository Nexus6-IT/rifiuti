import { BreakpointObserver } from '@angular/cdk/layout'
import { signal } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { AuthService } from '../../../../core/services/auth.service'
import { PermissionStore } from '../../../../core/state/permission.store'
import { RoleStore } from '../../../../core/state/role.store'
import { PermissionDiscoveryComponent } from './permission-discovery.component'

/**
 * Task 15 (bug 35, parte permessi): «I miei permessi» parla italiano. Il ruolo e' un badge in
 * sentence case (mai maiuscolo continuo), i permessi hanno nomi umani e l'ambito e' in italiano.
 */
describe('PermissionDiscoveryComponent (stile)', () => {
  let fixture: ComponentFixture<PermissionDiscoveryComponent>
  const permessi = signal<string[]>([
    'analytics:view-dashboard:all',
    'fir:create:facility',
    'fir:delete:own',
    'user:read:all',
  ])
  const ruoliUtente = signal<{ roleName: string }[]>([{ roleName: 'ADMIN' }])
  const ruoloAccount = signal<string>('ADMIN')

  const monta = (mobile = false) => {
    TestBed.configureTestingModule({
      imports: [PermissionDiscoveryComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: BreakpointObserver,
          useValue: { observe: () => of({ matches: mobile, breakpoints: {} }) },
        },
        {
          provide: PermissionStore,
          useValue: {
            permissions: permessi,
            isLoading: () => false,
            error: () => null,
            hasPermission: () => (p: string) => permessi().includes(p),
            ensurePermissionsLoaded: () => undefined,
            refreshPermissions: () => undefined,
          },
        },
        {
          provide: RoleStore,
          // `roles()` sono i ruoli dell'azienda: il primo NON e' quello dell'utente
          useValue: {
            roles: () => [{ name: 'VIEWER' }],
            userRoles: ruoliUtente,
            loadRoles: () => undefined,
          },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruoloAccount() }) } },
      ],
    })
    fixture = TestBed.createComponent(PermissionDiscoveryComponent)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('mostra il ruolo come badge in sentence case, in italiano, senza maiuscolo forzato', () => {
    const el = monta()
    const badge = el.querySelector<HTMLElement>('[data-testid="role-badge"]')!
    expect(badge.textContent?.trim()).toBe('Amministratore')
    const tag = badge.querySelector<HTMLElement>('.p-tag') ?? badge
    expect(getComputedStyle(tag).textTransform).not.toBe('uppercase')
    expect(el.querySelector('.page-subtitle')?.textContent).toContain('Accesso completo al sistema')
  })

  it("il ruolo e quello dell'utente, non il primo ruolo dell'azienda", () => {
    ruoliUtente.set([])
    ruoloAccount.set('OPERATOR')
    const el = monta()
    expect(el.querySelector('[data-testid="role-badge"]')?.textContent?.trim()).toBe('Operatore')
    ruoliUtente.set([{ roleName: 'ADMIN' }])
    ruoloAccount.set('ADMIN')
  })

  it('i permessi hanno nomi italiani e nessuna stringa inglese', () => {
    const el = monta()
    const testo = el.textContent ?? ''
    expect(testo).toContain('Vedere le analisi della dashboard')
    expect(testo).toContain('Creare i FIR')
    expect(testo).toContain('Eliminare i FIR')
    expect(testo).not.toMatch(/\b(Create|View|Delete|Invalid|permission)\b/)
  })

  it("l'ambito e in italiano e non in maiuscolo", () => {
    const el = monta()
    const ambiti = Array.from(el.querySelectorAll<HTMLElement>('.permission-scope'))
    const testi = ambiti.map(a => a.textContent?.trim())
    expect(testi).toContain('Tutti')
    expect(testi).toContain('Delle sedi assegnate')
    expect(testi).toContain('Solo i propri')
    expect(testi.join(' ')).not.toMatch(/\b(ALL|OWN|FACILITY)\b/)
    expect(getComputedStyle(ambiti[0]).textTransform).not.toBe('uppercase')
  })

  it("nessun emoji o simbolo testuale: lo stato e un'icona", () => {
    const el = monta()
    expect(el.textContent).not.toMatch(/[✓✗○]/)
    expect(el.querySelectorAll('.permission-icon i.pi').length).toBeGreaterThan(0)
  })

  it('un solo h1', () => {
    const el = monta()
    expect(el.querySelectorAll('h1').length).toBe(1)
  })
})
