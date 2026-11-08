import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { EsgComponent } from './esg.component'
import { EsgReport, EsgService } from './esg.service'

const REPORT: EsgReport = {
  period: null,
  totals: { producedKg: 12000, recoveryKg: 9000, disposalKg: 3000, recyclingRate: 0.75 },
  landfillDivertedKg: 9000,
  co2AvoidedKg: 4200,
  byCer: [{ cerCode: '17 04 05', recoveryKg: 9000, disposalKg: 3000, co2AvoidedKg: 4200 }],
}

describe('EsgComponent (DOM)', () => {
  let fixture: ComponentFixture<EsgComponent>
  const el = () => fixture.nativeElement as HTMLElement

  beforeEach(async () => {
    const service = jasmine.createSpyObj<EsgService>('EsgService', ['getReport'])
    service.getReport.and.returnValue(of(REPORT))
    await TestBed.configureTestingModule({
      imports: [EsgComponent],
      providers: [
        provideNoopAnimations(),
        { provide: EsgService, useValue: service },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(EsgComponent)
    fixture.detectChanges()
  })
  afterEach(() => fixture.destroy())

  it('scrive «CO₂» col pedice ovunque, mai «CO2»', () => {
    const testo = el().textContent ?? ''
    expect(testo).toContain('CO₂')
    expect(testo).not.toContain('CO2')
    expect(el().querySelector('h1')!.textContent).toContain('ESG / CO₂')
  })

  it('la card «CO₂ evitata» è una card come le altre: niente bordo né fondo teal', () => {
    const card = Array.from(el().querySelectorAll<HTMLElement>('.stat-card')).find(c =>
      c.textContent!.includes('CO₂ evitata')
    )!
    expect(card).toBeDefined()
    expect(card.className).not.toContain('accent')
    const altra = Array.from(el().querySelectorAll<HTMLElement>('.stat-card')).find(c =>
      c.textContent!.includes('Tasso di recupero')
    )!
    expect(getComputedStyle(card).borderTopColor).toBe(getComputedStyle(altra).borderTopColor)
    expect(getComputedStyle(card).backgroundColor).toBe(getComputedStyle(altra).backgroundColor)
  })
})
