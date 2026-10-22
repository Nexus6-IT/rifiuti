import {
  convertiInKg,
  normalizzaUnitaRegistro,
  simboloUnita,
} from './unita-misura-registro'

describe('normalizzaUnitaRegistro', () => {
  it('kg e tonnellate sono massa, maiuscole e spazi ignorati', () => {
    expect(normalizzaUnitaRegistro('KG')).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: false })
    expect(normalizzaUnitaRegistro(' kg ')).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: false })
    expect(normalizzaUnitaRegistro('Kilogrammi')).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: false })
    expect(normalizzaUnitaRegistro('t')).toEqual({ unita: 'T', massa: true, fattoreKg: 1000, vuota: false })
    expect(normalizzaUnitaRegistro('Tonnellate')).toEqual({ unita: 'T', massa: true, fattoreKg: 1000, vuota: false })
  })
  it('unità vuota = KG, ma segnalata (default dello schema e del DTO)', () => {
    for (const u of ['', '  ', null, undefined]) {
      expect(normalizzaUnitaRegistro(u as any)).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: true })
    }
  })
  it('le altre unità non sono di massa e non si convertono', () => {
    expect(normalizzaUnitaRegistro('litri')).toEqual({ unita: 'LITRI', massa: false, fattoreKg: null, vuota: false })
    expect(normalizzaUnitaRegistro('m3')).toEqual({ unita: 'M3', massa: false, fattoreKg: null, vuota: false })
  })
})

describe('convertiInKg', () => {
  it('converte kg e tonnellate al grammo', () => {
    expect(convertiInKg(500, 'KG')).toBe(500)
    expect(convertiInKg(1.25, 'T')).toBe(1250)
    expect(convertiInKg(0.001, 'tonnellate')).toBe(1)
    expect(convertiInKg(3, '')).toBe(3)
  })
  it('restituisce null per le unità non di massa', () => {
    for (const u of ['litri', 'l', 'LT', 'm3']) expect(convertiInKg(10, u)).toBeNull()
  })
})

describe('simboloUnita', () => {
  it('kg e t in minuscolo, vuota come kg, le altre come sono', () => {
    expect(simboloUnita(normalizzaUnitaRegistro('Tonnellate'))).toBe('t')
    expect(simboloUnita(normalizzaUnitaRegistro(''))).toBe('kg')
    expect(simboloUnita(normalizzaUnitaRegistro('m3'))).toBe('M3')
  })
})
