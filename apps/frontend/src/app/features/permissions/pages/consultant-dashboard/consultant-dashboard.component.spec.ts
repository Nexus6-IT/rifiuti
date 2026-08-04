/**
 * La vista d'insieme del gruppo mostra le dichiarazioni MUD ancora aperte.
 *
 * Il backend restituisce `{ tenantId, tenantName, year, status }`: non esiste
 * una data di scadenza, e il conteggio `totalMudDeadlines` non viene piu'
 * inviato. Il componente deve rendere anno e stato — mai una data inventata,
 * mai `NaN giorni`.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ConsultantDashboardComponent } from './consultant-dashboard.component'

const RISPOSTA_BACKEND = {
  totalTenants: 2,
  totalPendingFirs: 3,
  totalRentriSyncFailures: 0,
  pendingFirsByClient: [],
  upcomingDeadlines: [
    { tenantId: 'figlia-1', tenantName: 'Figlia Alfa Srl', year: 2025, status: 'DRAFT' },
    { tenantId: 'figlia-2', tenantName: 'Figlia Beta Srl', year: 2026, status: 'REVIEWING' },
  ],
  recentActivity: [],
  rentriSyncFailures: [],
  pendingFirsTrend: [],
}

describe('ConsultantDashboardComponent', () => {
  let fixture: ComponentFixture<ConsultantDashboardComponent>
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConsultantDashboardComponent, HttpClientTestingModule],
    })

    fixture = TestBed.createComponent(ConsultantDashboardComponent)
    http = TestBed.inject(HttpTestingController)
    fixture.detectChanges() // ngOnInit → GET
    http.expectOne('/api/v1/consultant/dashboard').flush(RISPOSTA_BACKEND)
    fixture.detectChanges()
  })

  afterEach(() => http.verify())

  it('mostra anno e stato di ogni dichiarazione MUD aperta', () => {
    const testo: string = fixture.nativeElement.textContent

    expect(testo).toContain('Figlia Alfa Srl')
    expect(testo).toContain('2025')
    expect(testo).toContain('2026')
  })

  it('non produce NaN ne date non valide: il backend non manda una data di scadenza', () => {
    const testo: string = fixture.nativeElement.textContent

    expect(testo).not.toContain('NaN')
    expect(testo).not.toContain('Invalid Date')
  })

  it('il conteggio dei MUD aperti viene dall elenco, non da un campo assente', () => {
    const testo: string = fixture.nativeElement.textContent

    // 2 dichiarazioni nella risposta: il KPI non puo' restare a zero.
    expect(testo).toContain('MUD da chiudere')
    expect(fixture.componentInstance.mudDaChiudere()).toBe(2)
  })
})
