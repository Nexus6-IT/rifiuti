import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of } from 'rxjs'

import { GiacenzeComponent } from './giacenze.component'
import { GiacenzeService, Giacenza } from './giacenze.service'
import { ToastService } from '../../core/services/toast.service'

function giacenza(overrides: Partial<Giacenza> = {}): Giacenza {
  return {
    cerCode: '17 04 05',
    caricoKg: 0,
    scaricoKg: 0,
    giacenzaKg: 0,
    oldestCaricoDate: null,
    altreUnita: [],
    scarichiSuFirAnnullati: [],
    ...overrides,
  }
}

describe('GiacenzeComponent', () => {
  let fixture: ComponentFixture<GiacenzeComponent>

  function setup(giacenze: Giacenza[]): void {
    const service = jasmine.createSpyObj<GiacenzeService>('GiacenzeService', [
      'getGiacenze',
      'getDepositoTemporaneoAlerts',
    ])
    service.getGiacenze.and.returnValue(of(giacenze))
    service.getDepositoTemporaneoAlerts.and.returnValue(of([]))

    TestBed.configureTestingModule({
      imports: [GiacenzeComponent],
      providers: [
        { provide: GiacenzeService, useValue: service },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    })
    fixture = TestBed.createComponent(GiacenzeComponent)
    fixture.detectChanges()
  }

  it('mostra le giacenze in unità diverse dal kg accanto alla riga del CER', () => {
    setup([
      giacenza({
        altreUnita: [{ unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30 }],
      }),
    ])
    expect(fixture.nativeElement.textContent).toContain('30 LITRI')
  })

  it('avvisa degli scarichi su FIR annullati', () => {
    setup([
      giacenza({
        scarichiSuFirAnnullati: [
          { numero: '2026/9', quantita: 200, unita: 'KG', fir: 'FIR-2026-000003' },
        ],
      }),
    ])
    expect(fixture.nativeElement.textContent).toContain(
      'Scarico 2026/9 (200 KG) collegato al FIR FIR-2026-000003, poi annullato: la giacenza lo conta ancora.'
    )
  })

  it('scrive le quantità aggiunte in formato italiano', () => {
    setup([
      giacenza({
        altreUnita: [{ unita: 'LITRI', carico: 1234.5, scarico: 0, giacenza: 1234.5 }],
        scarichiSuFirAnnullati: [
          { numero: '2026/9', quantita: 12500, unita: 'KG', fir: 'FIR-2026-000003' },
        ],
      }),
    ])
    const testo = fixture.nativeElement.textContent
    expect(testo).toContain('1.234,5 LITRI')
    expect(testo).toContain('Scarico 2026/9 (12.500 KG)')
  })
})
