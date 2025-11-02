/**
 * Indirizzo Value Object - TDD Tests
 * Italian address with validation
 */

import { Indirizzo } from './indirizzo'
import { InvalidIndirizzoError } from '../../../core/domain/errors'

describe('Indirizzo Value Object', () => {
  describe('create', () => {
    it('should create valid Italian address', () => {
      const indirizzo = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })

      expect(indirizzo.getVia()).toBe('Via Roma')
      expect(indirizzo.getCivico()).toBe('10')
      expect(indirizzo.getCAP()).toBe('00100')
      expect(indirizzo.getCitta()).toBe('Roma')
      expect(indirizzo.getProvincia()).toBe('RM')
    })

    it('should throw InvalidIndirizzoError for empty via', () => {
      expect(() =>
        Indirizzo.create({
          via: '',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        })
      ).toThrow(InvalidIndirizzoError)
    })

    it('should throw InvalidIndirizzoError for invalid CAP', () => {
      expect(() =>
        Indirizzo.create({
          via: 'Via Roma',
          civico: '10',
          cap: '123',
          citta: 'Roma',
          provincia: 'RM',
        })
      ).toThrow(InvalidIndirizzoError)
    })

    it('should throw InvalidIndirizzoError for invalid provincia', () => {
      expect(() =>
        Indirizzo.create({
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'X',
        })
      ).toThrow(InvalidIndirizzoError)
    })

    it('should trim whitespace from all fields', () => {
      const indirizzo = Indirizzo.create({
        via: '  Via Roma  ',
        civico: '  10  ',
        cap: '  00100  ',
        citta: '  Roma  ',
        provincia: '  RM  ',
      })

      expect(indirizzo.getVia()).toBe('Via Roma')
      expect(indirizzo.getCivico()).toBe('10')
      expect(indirizzo.getCAP()).toBe('00100')
      expect(indirizzo.getCitta()).toBe('Roma')
      expect(indirizzo.getProvincia()).toBe('RM')
    })

    it('should format address for display', () => {
      const indirizzo = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })

      expect(indirizzo.getFormatted()).toBe('Via Roma, 10 - 00100 Roma (RM)')
    })

    it('should handle optional nazione field', () => {
      const indirizzo = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
        nazione: 'Italia',
      })

      expect(indirizzo.getNazione()).toBe('Italia')
    })

    it('should default nazione to Italia', () => {
      const indirizzo = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })

      expect(indirizzo.getNazione()).toBe('Italia')
    })
  })

  describe('equals', () => {
    it('should return true for same address', () => {
      const ind1 = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })
      const ind2 = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })

      expect(ind1.equals(ind2)).toBe(true)
    })

    it('should return false for different addresses', () => {
      const ind1 = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })
      const ind2 = Indirizzo.create({
        via: 'Via Milano',
        civico: '20',
        cap: '20100',
        citta: 'Milano',
        provincia: 'MI',
      })

      expect(ind1.equals(ind2)).toBe(false)
    })
  })

  describe('toString', () => {
    it('should return formatted address string', () => {
      const indirizzo = Indirizzo.create({
        via: 'Via Roma',
        civico: '10',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      })

      expect(indirizzo.toString()).toBe('Via Roma, 10 - 00100 Roma (RM)')
    })
  })
})
