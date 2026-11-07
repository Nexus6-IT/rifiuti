import { TestBed } from '@angular/core/testing'
import { PrimeNGConfig } from 'primeng/api'
import { TRADUZIONE_PRIMENG_IT, applicaTraduzionePrimeng } from './primeng-it'

describe('traduzione italiana di PrimeNG', () => {
  it('ha mesi, giorni e testi del calendario in italiano, con la settimana che inizia di lunedi', () => {
    expect(TRADUZIONE_PRIMENG_IT.monthNames?.[10]).toBe('novembre')
    expect(TRADUZIONE_PRIMENG_IT.monthNames?.length).toBe(12)
    expect(TRADUZIONE_PRIMENG_IT.dayNamesMin).toEqual(['D', 'L', 'M', 'M', 'G', 'V', 'S'])
    expect(TRADUZIONE_PRIMENG_IT.dayNames?.[1]).toBe('lunedì')
    expect(TRADUZIONE_PRIMENG_IT.firstDayOfWeek).toBe(1)
    expect(TRADUZIONE_PRIMENG_IT.today).toBe('Oggi')
    expect(TRADUZIONE_PRIMENG_IT.clear).toBe('Cancella')
    expect(TRADUZIONE_PRIMENG_IT.dateFormat).toBe('dd/mm/yy')
  })

  it("applicaTraduzionePrimeng la imposta sulla configurazione dell'app", () => {
    const config = TestBed.inject(PrimeNGConfig)
    applicaTraduzionePrimeng(config)
    expect(config.getTranslation('monthNames')[0]).toBe('gennaio')
    expect(config.getTranslation('firstDayOfWeek')).toBe(1)
  })
})
