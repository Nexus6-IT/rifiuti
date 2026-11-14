import { etichettaPeriodoOrr, periodoOrr } from './orr.model'

describe('orr.model', () => {
  it('periodoOrr: primo e ultimo giorno di mesi interi, anche bisestili', () => {
    expect(periodoOrr(2026, 1, 3)).toEqual({ da: '2026-01-01', a: '2026-03-31' })
    expect(periodoOrr(2026, 5, 5)).toEqual({ da: '2026-05-01', a: '2026-05-31' })
    expect(periodoOrr(2024, 2, 2)).toEqual({ da: '2024-02-01', a: '2024-02-29' })
    expect(periodoOrr(2025, 2, 2)).toEqual({ da: '2025-02-01', a: '2025-02-28' })
    expect(periodoOrr(2026, 12, 12)).toEqual({ da: '2026-12-01', a: '2026-12-31' })
  })

  it('etichettaPeriodoOrr: un mese o un intervallo', () => {
    expect(etichettaPeriodoOrr('2026-05-01', '2026-05-31')).toBe('Maggio 2026')
    expect(etichettaPeriodoOrr('2026-01-01', '2026-03-31')).toBe('Gennaio – Marzo 2026')
  })
})
