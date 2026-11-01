import {
  bicValido,
  normalizzaContoCorrente,
  validaContoCorrente,
  type DatiContoCorrente,
} from './conto-corrente'

const valido = (extra: Partial<DatiContoCorrente> = {}): DatiContoCorrente => ({
  codice: 'BPER',
  descrizione: 'Conto principale',
  banca: 'Banca di esempio',
  iban: 'IT60X0542811101000000123456',
  bic: null,
  ...extra,
})

describe('contoCorrente', () => {
  it('conto valido', () => expect(validaContoCorrente(valido())).toEqual([]))

  it('descrizione e banca vuote', () => {
    expect(validaContoCorrente(valido({ descrizione: '' }))).toEqual(['Indica la descrizione.'])
    expect(validaContoCorrente(valido({ banca: '' }))).toEqual(['Indica la banca.'])
  })
  it('banca di 81 caratteri', () => {
    expect(validaContoCorrente(valido({ banca: 'B'.repeat(81) }))).toEqual([
      'La banca può avere al massimo 80 caratteri.',
    ])
    expect(validaContoCorrente(valido({ banca: 'B'.repeat(80) }))).toEqual([])
  })
  it('IBAN non valido o assente', () => {
    expect(validaContoCorrente(valido({ iban: 'IT60X0542811101000000123457' }))).toEqual([
      "L'IBAN non è valido.",
    ])
    expect(validaContoCorrente(valido({ iban: '' }))).toEqual(["L'IBAN non è valido."])
  })
  it('BIC di 8 e 11 validi, di 6 no', () => {
    expect(bicValido('UNCRITMM')).toBe(true)
    expect(bicValido('UNCRITMMXXX')).toBe(true)
    expect(bicValido('UNCRIT')).toBe(false)
    expect(validaContoCorrente(valido({ bic: 'UNCRIT' }))).toEqual(['Il BIC non è valido.'])
  })
  it('codice con spazio', () => {
    expect(validaContoCorrente(valido({ codice: 'A B' }))).toHaveLength(1)
  })
  it('normalizza: IBAN senza spazi, BIC maiuscolo, vuoto -> null', () => {
    const d = normalizzaContoCorrente({
      codice: ' c1 ',
      descrizione: ' d ',
      banca: ' b ',
      iban: 'it60 x054 2811 1010 0000 0123 456',
      bic: ' uncritmm ',
    })
    expect(d).toEqual({
      codice: 'c1',
      descrizione: 'd',
      banca: 'b',
      iban: 'IT60X0542811101000000123456',
      bic: 'UNCRITMM',
    })
    expect(normalizzaContoCorrente({ bic: '  ' }).bic).toBeNull()
  })
})
