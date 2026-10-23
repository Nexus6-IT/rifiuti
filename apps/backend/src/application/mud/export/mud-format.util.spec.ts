import { mudDate, mudDateOrZero, mudTime } from './mud-format.util'

// Il processo gira in UTC (come in CI): data e ora del file sono quelle di Roma, mai del server.
describe('mud-format.util - data e ora italiane', () => {
  // 31/12/2025 23:30:30 UTC = 01/01/2026 00:30:30 a Roma (ora solare, UTC+1)
  const capodanno = new Date('2025-12-31T23:30:30Z')
  // 15/07/2025 22:05:09 UTC = 16/07/2025 00:05:09 a Roma (ora legale, UTC+2)
  const estate = new Date('2025-07-15T22:05:09Z')

  it('mudDate usa il giorno di calendario di Roma', () => {
    expect(mudDate(capodanno)).toBe('20260101')
    expect(mudDate(estate)).toBe('20250716')
  })

  it('mudTime usa l ora di Roma', () => {
    expect(mudTime(capodanno)).toBe('003030')
    expect(mudTime(estate)).toBe('000509')
  })

  it('mudDateOrZero: 8 zeri senza data, altrimenti il giorno di Roma', () => {
    expect(mudDateOrZero(null)).toBe('00000000')
    expect(mudDateOrZero(undefined)).toBe('00000000')
    expect(mudDateOrZero(capodanno)).toBe('20260101')
  })
})
