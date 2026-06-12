import {
  co2FactorForCer,
  normalizeCer,
  DEFAULT_CO2_AVOIDED_FACTOR,
  CO2_AVOIDED_FACTOR_BY_CHAPTER,
} from './emission-factors'

describe('emission-factors', () => {
  it('normalizza il CER rimuovendo spazi e asterisco', () => {
    expect(normalizeCer('15 01 01')).toBe('150101')
    expect(normalizeCer('13 02 05*')).toBe('130205')
  })

  it('usa il fattore del capitolo CER (prime 2 cifre)', () => {
    expect(co2FactorForCer('15 01 01')).toBe(CO2_AVOIDED_FACTOR_BY_CHAPTER['15'])
    expect(co2FactorForCer('170504')).toBe(CO2_AVOIDED_FACTOR_BY_CHAPTER['17'])
  })

  it('usa il fattore di default per capitoli non mappati', () => {
    expect(co2FactorForCer('99 99 99')).toBe(DEFAULT_CO2_AVOIDED_FACTOR)
    expect(co2FactorForCer('')).toBe(DEFAULT_CO2_AVOIDED_FACTOR)
  })
})
