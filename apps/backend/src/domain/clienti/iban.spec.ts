import { ibanValido, normalizzaIban } from './iban'

describe('IBAN', () => {
  it('IBAN italiano valido (IT60X0542811101000000123456)', () => {
    expect(ibanValido('IT60X0542811101000000123456')).toBe(true)
  })

  it('con una cifra cambiata: non valido', () => {
    expect(ibanValido('IT60X0542811101000000123457')).toBe(false)
  })

  it('italiano di 26 caratteri: non valido', () => {
    expect(ibanValido('IT60X054281110100000012345')).toBe(false)
  })

  it('con spazi e minuscole: normalizzato e valido', () => {
    const n = normalizzaIban(' it60 x054 2811 1010 0000 0123 456 ')
    expect(n).toBe('IT60X0542811101000000123456')
    expect(ibanValido(n)).toBe(true)
  })

  it('tedesco di 22 valido', () => {
    expect(ibanValido('DE89370400440532013000')).toBe(true)
  })

  it('paese sconosciuto di 14: non valido', () => {
    expect(ibanValido('ZZ6012345678901')).toBe(false)
    expect(ibanValido('ZZ601234567890')).toBe(false)
  })
})
