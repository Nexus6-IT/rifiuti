import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { RENTRISyncBadgeComponent } from './rentri-sync-badge.component'

/**
 * TDD per il badge di stato RENTRI (R1 Task 3).
 *
 * Il componente pre-esistente aveva testi in inglese e stati inventati
 * (IN_PROGRESS, "Unknown") mai coerenti con `RENTRISyncStatus` reale
 * (PENDING/SYNCING/SYNCED/FAILED/PERMANENTLY_FAILED) e zero `data-testid`.
 * Questi test bloccano la regressione a quel comportamento.
 */
describe('RENTRISyncBadgeComponent', () => {
  let fixture: ComponentFixture<RENTRISyncBadgeComponent>
  let component: RENTRISyncBadgeComponent

  const setInputs = (overrides: Partial<RENTRISyncBadgeComponent>) => {
    Object.assign(component, overrides)
    fixture.detectChanges()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RENTRISyncBadgeComponent, HttpClientTestingModule],
    }).compileComponents()

    fixture = TestBed.createComponent(RENTRISyncBadgeComponent)
    component = fixture.componentInstance
    component.numeroFir = 'FIR-2026-000001'
  })

  it('espone il data-testid convenzionale rentri-sync-badge-{numeroFir}', () => {
    setInputs({ rentriSyncStatus: 'PENDING' })

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="rentri-sync-badge-FIR-2026-000001"]')).toBeTruthy()
  })

  it('mostra testo italiano "Da trasmettere" per lo stato PENDING', () => {
    setInputs({ rentriSyncStatus: 'PENDING' })
    expect(component['getDisplayText']()).toBe('Da trasmettere')
    expect(component['getSeverity']()).toBe('secondary')
  })

  it('mostra il numero ufficiale per lo stato SYNCED', () => {
    setInputs({ rentriSyncStatus: 'SYNCED', rentriNumeroFir: 'RENTRI-000999' })
    expect(component['getDisplayText']()).toBe('A posto — RENTRI-000999')
    expect(component['getSeverity']()).toBe('success')
  })

  it('distingue il legame PROPOSTO (modalità ibrida) dal numero ufficiale', () => {
    setInputs({
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: null,
      rentriNumeroFirProposto: 'RENTRI-PROP-1',
    })

    expect(component['getDisplayText']()).toContain('Da confermare')
    expect(component['getDisplayText']()).toContain('RENTRI-PROP-1')
    expect(component['getDisplayText']()).not.toContain('A posto')
    expect(component['getSeverity']()).toBe('warning')
  })

  it('non tratta un legame confermato come "da confermare" anche se una proposta è residua', () => {
    setInputs({
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000999',
      rentriNumeroFirProposto: null,
    })

    expect(component['getDisplayText']()).toBe('A posto — RENTRI-000999')
  })

  it('segnala il fallimento con severità di attenzione e conteggio tentativi', () => {
    setInputs({ rentriSyncStatus: 'FAILED', syncAttempts: 2, lastSyncError: 'Timeout' })

    expect(component['getDisplayText']()).toBe('Riprova 2/5')
    expect(component['getSeverity']()).toBe('warning')
    expect(component['getTooltipText']()).toContain('Timeout')
  })

  it('preferisce il messaggio tradotto (R1 Task 5) al testo tecnico grezzo nel tooltip', () => {
    setInputs({
      rentriSyncStatus: 'FAILED',
      syncAttempts: 1,
      lastSyncError: 'Certificato non riconosciuto',
      messaggioErrore:
        'Il certificato della tua azienda non è valido per questa operazione: verifica il certificato nella pagina dedicata. Ritentare non risolve il problema.',
    })

    expect(component['getTooltipText']()).toContain('certificato')
    expect(component['getTooltipText']()).not.toContain('Verrà ritentato automaticamente')
  })

  it('segnala il fallimento permanente con severità danger', () => {
    setInputs({ rentriSyncStatus: 'PERMANENTLY_FAILED', syncAttempts: 5 })

    expect(component['getDisplayText']()).toBe('Richiede intervento')
    expect(component['getSeverity']()).toBe('danger')
  })
})
