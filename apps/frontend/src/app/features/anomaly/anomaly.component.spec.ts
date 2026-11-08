import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { Anomaly, AnomalyService } from './anomaly.service'
import { AnomalyComponent } from './anomaly.component'

const anomalia = (severity: Anomaly['severity']): Anomaly => ({
  severity,
  type: 'MISSING_DESCRIPTION',
  message: 'Descrizione rifiuto mancante',
})

describe('AnomalyComponent (DOM)', () => {
  let fixture: ComponentFixture<AnomalyComponent>
  const el = () => fixture.nativeElement as HTMLElement

  beforeEach(async () => {
    const service = jasmine.createSpyObj<AnomalyService>('AnomalyService', ['detect'])
    service.detect.and.returnValue(
      of([anomalia('HIGH'), anomalia('MEDIUM'), anomalia('MEDIUM'), anomalia('LOW')])
    )
    await TestBed.configureTestingModule({
      imports: [AnomalyComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AnomalyService, useValue: service },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(AnomalyComponent)
    fixture.detectChanges()
  })
  afterEach(() => fixture.destroy())

  it('i tre KPI stanno in un solo contenitore diviso con tre celle', () => {
    const strisce = el().querySelectorAll('.striscia')
    expect(strisce.length).toBe(1)
    expect(strisce[0].querySelectorAll('.cella').length).toBe(3)
    expect(el().querySelectorAll('.stat-card').length).toBe(0)
  })

  it('le celle dicono la gravità come parola e il numero, col pallino', () => {
    const celle = Array.from(el().querySelectorAll<HTMLElement>('.striscia .cella'))
    expect(celle.map(c => c.querySelector('.cella__l')!.textContent!.trim())).toEqual([
      'Gravità alta',
      'Gravità media',
      'Gravità bassa',
    ])
    expect(celle.map(c => c.querySelector('.cella__v')!.textContent!.trim())).toEqual([
      '1',
      '2',
      '1',
    ])
    celle.forEach(c => expect(c.querySelector('.pallino')).not.toBeNull())
  })

  it('nessuna cella ha un bordo colorato di stato: solo il filetto neutro fra le celle', () => {
    const striscia = el().querySelector<HTMLElement>('.striscia')!
    const neutro = getComputedStyle(striscia).borderTopColor
    const celle = Array.from(el().querySelectorAll<HTMLElement>('.striscia .cella'))
    celle.forEach(c => {
      const s = getComputedStyle(c)
      expect(s.borderTopWidth).toBe('0px')
      expect(s.borderBottomWidth).toBe('0px')
      if (s.borderLeftWidth !== '0px') expect(s.borderLeftColor).toBe(neutro)
    })
  })

  it('il numero resta nell inchiostro del testo, non nel colore dello stato', () => {
    const testo = getComputedStyle(el()).color
    const valori = Array.from(el().querySelectorAll<HTMLElement>('.cella__v'))
    valori.forEach(v => expect(getComputedStyle(v).color).toBe(testo))
  })
})
