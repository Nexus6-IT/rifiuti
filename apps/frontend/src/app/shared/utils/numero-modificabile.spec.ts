import { FormControl } from '@angular/forms'
import {
  MSG_NUMERO,
  MSG_VIRGOLA,
  formatCascata,
  formatNumero,
  leggiCascata,
  leggiIntero,
  leggiNumero,
  messaggioNumero,
  validatoreNumero,
} from './numero-modificabile'

describe('numero-modificabile', () => {
  describe('leggiNumero', () => {
    it('la virgola diventa il punto del backend', () => {
      expect(leggiNumero('1234,5')).toEqual({ valore: '1234.5', errore: null })
      expect(leggiNumero(' 0,08 ')).toEqual({ valore: '0.08', errore: null })
      expect(leggiNumero('1000')).toEqual({ valore: '1000', errore: null })
    })
    it('`,5` e `5,` sono accettati mentre si scrive', () => {
      expect(leggiNumero(',5')).toEqual({ valore: '0.5', errore: null })
      expect(leggiNumero('5,')).toEqual({ valore: '5', errore: null })
      expect(leggiNumero('-,5')).toEqual({ valore: '-0.5', errore: null })
      expect(leggiCascata('10+,5').valore).toBe('10+0.5')
    })
    it('vuoto = nessun valore, nessun errore', () => {
      expect(leggiNumero('  ')).toEqual({ valore: null, errore: null })
    })
    it('il punto è vietato, anche come migliaia', () => {
      expect(leggiNumero('1.000')).toEqual({ valore: null, errore: MSG_VIRGOLA })
      expect(leggiNumero('0.08')).toEqual({ valore: null, errore: MSG_VIRGOLA })
      expect(leggiNumero('1.234,5').errore).toBe(MSG_VIRGOLA)
    })
    it('testo che non è un numero', () => {
      expect(leggiNumero('1a').errore).toBe(MSG_NUMERO)
      expect(leggiNumero('1,2,3').errore).toBe(MSG_NUMERO)
      expect(leggiNumero(',').errore).toBe(MSG_NUMERO)
    })
  })

  describe('leggiCascata', () => {
    it('10+5,5 → 10+5.5', () => {
      expect(leggiCascata('10 + 5,5')).toEqual({ valore: '10+5.5', errore: null })
    })
    it('punto e testo errati', () => {
      expect(leggiCascata('10+5.5').errore).toBe(MSG_VIRGOLA)
      expect(leggiCascata('10+a').errore).toBe(MSG_NUMERO)
      expect(leggiCascata('10+').errore).toBe(MSG_NUMERO)
    })
  })

  describe('leggiIntero', () => {
    it('solo cifre', () => {
      expect(leggiIntero('15')).toEqual({ valore: 15, errore: null })
      expect(leggiIntero('')).toEqual({ valore: null, errore: null })
      expect(leggiIntero('1a').errore).toBe(MSG_NUMERO)
      expect(leggiIntero('2026x').errore).toBe(MSG_NUMERO)
      expect(leggiIntero('1,5').errore).toBe(MSG_NUMERO)
    })
  })

  describe('formatNumero', () => {
    it('niente migliaia, niente zeri finali inutili', () => {
      expect(formatNumero('1000.00')).toBe('1000')
      expect(formatNumero('1234.50')).toBe('1234,5')
      expect(formatNumero('12000.000000')).toBe('12000')
      expect(formatNumero('0.080000')).toBe('0,08')
    })
    it('con due decimali minimi', () => {
      expect(formatNumero('1000.00', 2)).toBe('1000,00')
      expect(formatNumero('1000', 2)).toBe('1000,00')
    })
    it('vuoto e testo strano', () => {
      expect(formatNumero(null)).toBe('')
      expect(formatNumero('10+5')).toBe('10+5')
    })
    it('ciò che si legge si rilegge identico', () => {
      for (const v of ['1000.00', '1234.50', '0.08', '5000']) {
        expect(leggiNumero(formatNumero(v)).valore).toBe(String(Number(v)))
      }
    })
  })

  it('formatCascata', () => {
    expect(formatCascata('12.5+5')).toBe('12,5+5')
  })

  it('validatore: errore `numero` con il messaggio', () => {
    const c = new FormControl('1.000', { validators: [validatoreNumero('decimale')] })
    expect(messaggioNumero(c)).toBe(MSG_VIRGOLA)
    c.setValue('1000')
    expect(c.valid).toBeTrue()
    expect(messaggioNumero(c)).toBeNull()
    expect(
      new FormControl('10+5,5', { validators: [validatoreNumero('cascata')] }).valid
    ).toBeTrue()
  })
})
