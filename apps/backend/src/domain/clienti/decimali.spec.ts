import { confrontaDecimali, decimaleValido, normalizzaDecimale } from './decimali'

describe('decimali', () => {
  it('normalizzaDecimale e decimaleValido', () => {
    expect(normalizzaDecimale('4')).toBe('4.00')
    expect(normalizzaDecimale('4,5')).toBe('4.50')
    expect(normalizzaDecimale('4.25')).toBe('4.25')
    expect(normalizzaDecimale('  ')).toBeNull()
    expect(normalizzaDecimale(null)).toBeNull()
    expect(normalizzaDecimale('1.234')).toBe('1.234')
    expect(decimaleValido('1.234', 8)).toBe(false)
    expect(decimaleValido('-1', 8)).toBe(false)
    expect(decimaleValido('0', 8)).toBe(true)
    expect(decimaleValido('123456789', 8)).toBe(false)
    expect(decimaleValido('12345678.99', 8)).toBe(true)
  })

  it('confrontaDecimali', () => {
    expect(confrontaDecimali('30.00', '30')).toBe(0)
    expect(confrontaDecimali('30.01', '30')).toBe(1)
    expect(confrontaDecimali('4.5', '30')).toBe(-1)
    expect(confrontaDecimali('100', '99.99')).toBe(1)
  })
})
