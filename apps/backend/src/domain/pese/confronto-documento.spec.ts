import { confrontaConDocumento, nettoNellUnitaFir } from './confronto-documento'

describe('confrontaConDocumento', () => {
  it('KG 12.340 vs 12.340 → differenza 0', () => {
    expect(confrontaConDocumento(12340, 12340, 'KG')).toEqual({
      confrontabile: true,
      quantitaKg: 12340,
      differenzaKg: 0,
    })
  })
  it('T 12,34 → 12.340 kg', () => {
    expect(confrontaConDocumento(12340, 12.34, 'T')).toEqual({
      confrontabile: true,
      quantitaKg: 12340,
      differenzaKg: 0,
    })
  })
  it('unità vuota = kg; differenza con segno', () => {
    expect(confrontaConDocumento(12400, 12340, '')).toMatchObject({
      confrontabile: true,
      differenzaKg: 60,
    })
  })
  it("'M3' → non confrontabile", () => {
    expect(confrontaConDocumento(12340, 12, 'M3')).toEqual({
      confrontabile: false,
      quantitaKg: null,
      differenzaKg: null,
    })
  })
  it('netto null → non confrontabile', () => {
    expect(confrontaConDocumento(null, 12340, 'KG').confrontabile).toBe(false)
  })
})

describe('nettoNellUnitaFir', () => {
  it('conversioni', () => {
    expect(nettoNellUnitaFir(12345, 'T')).toBe(12.35)
    expect(nettoNellUnitaFir(12340, 'kg')).toBe(12340)
    expect(nettoNellUnitaFir(1, 'L')).toBeNull()
  })
})
