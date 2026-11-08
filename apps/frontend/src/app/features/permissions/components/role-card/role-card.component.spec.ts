import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Role } from '../../../../core/state/role.store'
import { RoleCardComponent } from './role-card.component'

/** Task 15: la scheda del ruolo parla italiano (nome, tipo, permessi, azioni). */
describe('RoleCardComponent (italiano)', () => {
  let fixture: ComponentFixture<RoleCardComponent>
  const ruolo = (over: Partial<Role> = {}): Role => ({
    id: 'r1',
    name: 'ADMIN',
    description: 'Full administrative access to tenant.',
    isSystemRole: true,
    permissions: ['fir:create:all', 'analytics:view-dashboard:all'],
    ...over,
  })

  const monta = (r: Role) => {
    TestBed.configureTestingModule({
      imports: [RoleCardComponent],
      providers: [provideNoopAnimations()],
    })
    fixture = TestBed.createComponent(RoleCardComponent)
    fixture.componentInstance.role = r
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('nome, tipo e descrizione di un ruolo di sistema sono in italiano', () => {
    const testo = monta(ruolo()).textContent ?? ''
    expect(testo).toContain('Amministratore di sistema')
    expect(testo).toContain('Di sistema')
    expect(testo).toContain('Accesso completo al sistema')
    expect(testo).not.toMatch(
      /Full administrative|System\b|Custom\b|Permissions|Assign\b|View Details/
    )
  })

  it('i permessi in anteprima hanno nomi italiani e le azioni sono in italiano', () => {
    const el = monta(ruolo())
    const testo = el.textContent ?? ''
    expect(testo).toContain('Creare i FIR')
    expect(testo).toContain('Vedere le analisi della dashboard')
    const bottoni = Array.from(el.querySelectorAll('button')).map(b => b.textContent?.trim())
    expect(bottoni).toEqual(['Assegna', 'Dettagli', 'Utenti'])
  })

  it("un ruolo personalizzato conserva la descrizione scritta dall'azienda", () => {
    const testo =
      monta(
        ruolo({
          name: 'RESPONSABILE_MAGAZZINO',
          isSystemRole: false,
          description: 'Segue il magazzino.',
        })
      ).textContent ?? ''
    expect(testo).toContain('Responsabile magazzino')
    expect(testo).toContain('Personalizzato')
    expect(testo).toContain('Segue il magazzino.')
  })
})
