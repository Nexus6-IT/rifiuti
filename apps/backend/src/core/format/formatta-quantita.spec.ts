import { formattaQuantita } from './formatta-quantita'

describe('formattaQuantita', () => {
  it.each([
    [1234.5, '1.234,5'],
    [12345.5, '12.345,5'],
    [0.4, '0,4'],
    [1.25, '1,25'],
    [100, '100'],
    [-100, '-100'],
  ])('formattaQuantita(%p) = %s', (n, atteso) => {
    expect(formattaQuantita(n)).toBe(atteso)
  })
})
