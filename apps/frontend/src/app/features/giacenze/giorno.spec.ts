import { formattaGiorno } from './giorno'

describe('formattaGiorno', () => {
  it('scrive il giorno come GG/MM/AAAA', () => {
    expect(formattaGiorno('2026-03-01')).toBe('01/03/2026')
  })

  it('non sposta il 31 dicembre né il 29 febbraio', () => {
    expect(formattaGiorno('2026-12-31')).toBe('31/12/2026')
    expect(formattaGiorno('2028-02-29')).toBe('29/02/2028')
  })

  it('con un valore vuoto o in altro formato scrive un trattino', () => {
    expect(formattaGiorno('')).toBe('-')
    expect(formattaGiorno(null)).toBe('-')
    expect(formattaGiorno(undefined)).toBe('-')
    expect(formattaGiorno('2026-03-01T00:00:00.000Z')).toBe('-')
    expect(formattaGiorno('01/03/2026')).toBe('-')
  })
})
