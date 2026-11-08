import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RENTRISyncService, SyncLogsResponse } from '../../services/rentri-sync.service'
import { RENTRISyncLogsComponent } from './rentri-sync-logs.component'

/** I6 del pezzo C: un errore di caricamento non deve apparire insieme a «Nessun log». */
describe('RENTRISyncLogsComponent (errore e stato vuoto)', () => {
  let fixture: ComponentFixture<RENTRISyncLogsComponent>
  let servizio: jasmine.SpyObj<RENTRISyncService>

  const monta = (risposta: 'errore' | 'vuoto'): HTMLElement => {
    servizio = jasmine.createSpyObj<RENTRISyncService>('RENTRISyncService', ['getSyncLogs'])
    const vuoto = of({ data: [], total: 0 } as unknown as SyncLogsResponse)
    servizio.getSyncLogs.and.returnValue(
      risposta === 'errore' ? throwError(() => new Error('400')) : vuoto
    )
    spyOn(console, 'error')
    TestBed.configureTestingModule({
      imports: [RENTRISyncLogsComponent, NoopAnimationsModule],
      providers: [{ provide: RENTRISyncService, useValue: servizio }],
    })
    fixture = TestBed.createComponent(RENTRISyncLogsComponent)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }
  const tabella = (el: HTMLElement) =>
    el.querySelector<HTMLElement>('[data-testid="rentri-sync-logs-table"]')!

  it('con un errore mostra il messaggio e nasconde tabella, «Nessun log» e paginatore', () => {
    const el = monta('errore')
    expect(el.querySelector('[data-testid="rentri-sync-logs-error"]')).not.toBeNull()
    expect(getComputedStyle(tabella(el)).display).toBe('none')
    expect(tabella(el).offsetParent).toBeNull()
  })

  it('senza errore e senza log mostra «Nessun log di sincronizzazione trovato»', () => {
    const el = monta('vuoto')
    expect(el.querySelector('[data-testid="rentri-sync-logs-error"]')).toBeNull()
    expect(getComputedStyle(tabella(el)).display).not.toBe('none')
    expect(el.querySelector('[data-testid="rentri-sync-logs-empty"]')?.textContent).toContain(
      'Nessun log'
    )
  })
})
