import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ActivatedRoute, provideRouter } from '@angular/router'
import { of } from 'rxjs'
import { PermissionStore } from '../../../../core/state/permission.store'
import { PermissionDeniedComponent } from './permission-denied.component'

/** Task 15 (bug 19): la pagina di accesso negato che il guard del super amministratore raggiunge. */
describe('PermissionDeniedComponent (accesso negato)', () => {
  let fixture: ComponentFixture<PermissionDeniedComponent>

  const apri = (params: Record<string, string>) => {
    TestBed.configureTestingModule({
      imports: [PermissionDeniedComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of(params) } },
        { provide: PermissionStore, useValue: { permissions: () => [] } },
      ],
    })
    fixture = TestBed.createComponent(PermissionDeniedComponent)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('dice quale pagina e quale ruolo, in italiano e con il nome del ruolo (non il codice)', () => {
    const el = apri({ resource: 'Abbonamento', role: 'ADMIN' })
    const testo = el.textContent ?? ''
    expect(testo).toContain('«Abbonamento»')
    expect(testo).toContain('amministratore di sistema')
    expect(el.querySelector('[data-testid="ruolo-attuale"]')?.textContent).toContain(
      'Amministratore di sistema'
    )
    expect(testo).not.toMatch(/\bADMIN\b/)
  })

  it('ha un solo h1 e nessun <main> annidato in quello della shell', () => {
    const el = apri({ resource: 'Abbonamento', role: 'ADMIN' })
    expect(el.querySelectorAll('h1').length).toBe(1)
    expect(el.querySelector('main')).toBeNull()
  })

  it('un solo bottone primario (arancio): «Vai alla dashboard»', () => {
    const el = apri({ resource: 'Abbonamento', role: 'ADMIN' })
    const primari = el.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(primari[0].getAttribute('data-testid')).toBe('vai-alla-dashboard')
  })
})
