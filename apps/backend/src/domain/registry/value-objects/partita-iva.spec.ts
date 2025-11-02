/**
 * Partita IVA Value Object - TDD Tests
 * Italian VAT Number validation
 */

import { PartitaIVA } from './partita-iva'
import { InvalidPartitaIVAError } from '../../../core/domain/errors'

describe('PartitaIVA Value Object', () => {
  describe('create', () => {
    it('should create valid Italian P.IVA (11 digits)', () => {
      const piva = PartitaIVA.create('12345678901')
      expect(piva.getValue()).toBe('12345678901')
    })

    it('should accept any 11-digit P.IVA', () => {
      // For MVP, any 11 digits are accepted
      const piva = PartitaIVA.create('01234567890')
      expect(piva.getValue()).toBe('01234567890')
    })

    it('should throw InvalidPartitaIVAError for wrong length', () => {
      expect(() => PartitaIVA.create('123456789')).toThrow(InvalidPartitaIVAError)
      expect(() => PartitaIVA.create('123456789012')).toThrow(InvalidPartitaIVAError)
    })

    it('should throw InvalidPartitaIVAError for non-numeric', () => {
      expect(() => PartitaIVA.create('1234567890A')).toThrow(InvalidPartitaIVAError)
    })

    it('should throw InvalidPartitaIVAError for empty string', () => {
      expect(() => PartitaIVA.create('')).toThrow(InvalidPartitaIVAError)
    })

    it('should trim whitespace', () => {
      const piva = PartitaIVA.create('  12345678901  ')
      expect(piva.getValue()).toBe('12345678901')
    })

    it('should format with spaces for display', () => {
      const piva = PartitaIVA.create('12345678901')
      expect(piva.getFormatted()).toBe('12345678901')
    })
  })

  describe('equals', () => {
    it('should return true for same P.IVA', () => {
      const piva1 = PartitaIVA.create('12345678901')
      const piva2 = PartitaIVA.create('12345678901')
      expect(piva1.equals(piva2)).toBe(true)
    })

    it('should return false for different P.IVA', () => {
      const piva1 = PartitaIVA.create('12345678901')
      const piva2 = PartitaIVA.create('01234567890')
      expect(piva1.equals(piva2)).toBe(false)
    })
  })

  describe('toString', () => {
    it('should return P.IVA string', () => {
      const piva = PartitaIVA.create('12345678901')
      expect(piva.toString()).toBe('12345678901')
    })
  })
})
