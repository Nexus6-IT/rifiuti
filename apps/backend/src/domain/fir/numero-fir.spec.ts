import { formattaNumeroFir } from './numero-fir'

describe('numero-fir', () => {
  it('formattaNumeroFir', () => {
    expect(formattaNumeroFir(2027, 1)).toBe('FIR-2027-000001')
    expect(formattaNumeroFir(2027, 1234567)).toBe('FIR-2027-1234567')
  })
})
