import { formattaQuantita } from './formatta-quantita'

describe('formattaQuantita', () => {
  it('usa il formato italiano con il separatore delle migliaia anche a 4 cifre', () => {
    expect(formattaQuantita(1234.5)).toBe('1.234,5')
    expect(formattaQuantita(0.4)).toBe('0,4')
    expect(formattaQuantita(12500)).toBe('12.500')
  })
})
