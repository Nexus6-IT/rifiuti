import { giornoFestivo, pasqua } from './festivi'

describe('giornoFestivo', () => {
  it.each([
    '2026-11-08',
    '2026-04-06',
    '2026-06-02',
    '2026-12-08',
    '2027-10-04',
    '2026-01-01',
    '2026-12-26',
  ])('%s è festivo', d => expect(giornoFestivo(d)).toBe(true))
  it.each(['2026-11-02', '2026-04-07', '2025-10-04', '2026-02-30', 'x'])('%s non è festivo', d =>
    expect(giornoFestivo(d)).toBe(false)
  )
  it('Pasqua gregoriana', () => {
    expect(pasqua(2026)).toEqual([4, 5])
    expect(pasqua(2027)).toEqual([3, 28])
    expect(pasqua(2025)).toEqual([4, 20])
  })
  it('4 ottobre dal 2026 (sabato 2025 no, domenica 2026 sì)', () => {
    expect(giornoFestivo('2026-10-04')).toBe(true)
    expect(giornoFestivo('2028-10-04')).toBe(true)
  })
})
