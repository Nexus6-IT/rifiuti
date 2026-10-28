import { annoBilancioValido, periodoBilancio, variazione } from './periodo-bilancio'

const OGGI = new Date('2026-10-28T10:00:00Z')

describe('periodoBilancio', () => {
  it('anno in corso: dal 1° gennaio a oggi', () => {
    expect(periodoBilancio(2026, OGGI)).toEqual({
      anno: 2026,
      dal: '2026-01-01',
      al: '2026-10-28',
      annoInCorso: true,
      alAnnoPrecedente: '2025-10-28',
      mesiDelPeriodo: 10,
    })
  })

  it('anno passato: anno intero', () => {
    expect(periodoBilancio(2024, OGGI)).toEqual({
      anno: 2024,
      dal: '2024-01-01',
      al: '2024-12-31',
      annoInCorso: false,
      alAnnoPrecedente: '2023-12-31',
      mesiDelPeriodo: 12,
    })
  })

  it("29 febbraio: l'anno prima si ferma al 28", () => {
    const p = periodoBilancio(2028, new Date('2028-02-29T12:00:00Z'))
    expect(p.al).toBe('2028-02-29')
    expect(p.alAnnoPrecedente).toBe('2027-02-28')
    expect(p.mesiDelPeriodo).toBe(2)
  })

  it('oggi in ora italiana: 31/12 alle 23:30 UTC è già il nuovo anno', () => {
    const p = periodoBilancio(2027, new Date('2026-12-31T23:30:00Z'))
    expect(p.al).toBe('2027-01-01')
    expect(p.annoInCorso).toBe(true)
  })

  it('anno futuro o prima del 2000: RangeError', () => {
    expect(() => periodoBilancio(2027, OGGI)).toThrow(RangeError)
    expect(() => periodoBilancio(1999, OGGI)).toThrow('Anno non valido')
  })
})

describe('annoBilancioValido', () => {
  it("accetta interi tra 2000 e l'anno italiano corrente", () => {
    expect(annoBilancioValido(2000, OGGI)).toBe(true)
    expect(annoBilancioValido(2026, OGGI)).toBe(true)
    expect(annoBilancioValido(2027, OGGI)).toBe(false)
    expect(annoBilancioValido(1999, OGGI)).toBe(false)
    expect(annoBilancioValido(2025.5, OGGI)).toBe(false)
    expect(annoBilancioValido(Number.NaN, OGGI)).toBe(false)
  })
})

describe('variazione', () => {
  it('nulla con base zero', () => {
    expect(variazione(10, 0)).toBeNull()
    expect(variazione(10, -5)).toBeNull()
    expect(variazione(150, 100)).toBe(0.5)
    expect(variazione(50, 100)).toBe(-0.5)
  })
})
