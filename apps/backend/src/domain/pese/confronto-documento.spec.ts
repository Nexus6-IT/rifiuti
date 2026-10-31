import { confrontaConDocumento, nettoNellUnitaFir, PESO_FIR_MINIMO } from './confronto-documento'

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

  it.each([
    [1, 'T', 0], // sotto i 5 kg arrotonda a zero: lo rifiuta chi chiama (PESO_FIR_MINIMO)
    [0.4, 'T', 0],
    [4.99, 'T', 0],
    [5, 'T', 0.01],
    [999.5, 'T', 1], // 0,9995 t → 1,00 t (arrotondamento al centesimo, metà in su)
    [1005, 'T', 1.01],
    [12345, 'T', 12.35],
    [99992999.99, 'T', 99993],
    [99999999.99, 'T', 100000], // oltre la colonna Decimal(10,2) in kg? no: in t e' 100000,00, valido
    [0.4, 'KG', 0.4],
    [99999999.99, 'KG', 99999999.99],
  ])('%s kg in %s → %s', (kg, unita, atteso) => {
    expect(nettoNellUnitaFir(kg, unita)).toBe(atteso)
  })

  it.each(['M3', 'L', 'mc', 'litri'])('unità a volume %s → null (non si converte)', unita => {
    expect(nettoNellUnitaFir(1000, unita)).toBeNull()
  })

  it('il minimo registrabile è quello della colonna del FIR', () => {
    expect(PESO_FIR_MINIMO).toBe(0.01)
  })
})
