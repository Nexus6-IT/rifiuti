/**
 * Quantita Value Object - TDD Tests
 */

import { Quantita, UnitaMisura } from './quantita'
import { InvalidQuantityError } from '../../../core/domain/errors'

describe('Quantita Value Object', () => {
  describe('create', () => {
    it('should create valid quantity', () => {
      const quantita = Quantita.create(120, UnitaMisura.KG)
      expect(quantita.valore).toBe(120)
      expect(quantita.unitaMisura).toBe(UnitaMisura.KG)
    })

    it('should default to KG if unit not specified', () => {
      const quantita = Quantita.create(100)
      expect(quantita.unitaMisura).toBe(UnitaMisura.KG)
    })

    it('should throw InvalidQuantityError for zero', () => {
      expect(() => Quantita.create(0)).toThrow(InvalidQuantityError)
    })

    it('should throw InvalidQuantityError for negative value', () => {
      expect(() => Quantita.create(-50)).toThrow(InvalidQuantityError)
    })
  })

  describe('isWithinTolerance', () => {
    it('should return true for exact match', () => {
      const quantita = Quantita.create(1000)
      expect(quantita.isWithinTolerance(1000)).toBe(true)
    })

    it('should return true for +10% tolerance', () => {
      const quantita = Quantita.create(1000)
      expect(quantita.isWithinTolerance(1100)).toBe(true) // +10%
    })

    it('should return true for -10% tolerance', () => {
      const quantita = Quantita.create(1000)
      expect(quantita.isWithinTolerance(900)).toBe(true) // -10%
    })

    it('should return false for +11% (exceeds tolerance)', () => {
      const quantita = Quantita.create(1000)
      expect(quantita.isWithinTolerance(1110)).toBe(false) // +11%
    })

    it('should return false for -11% (exceeds tolerance)', () => {
      const quantita = Quantita.create(1000)
      expect(quantita.isWithinTolerance(890)).toBe(false) // -11%
    })

    it('should support custom tolerance percentage', () => {
      const quantita = Quantita.create(1000)
      expect(quantita.isWithinTolerance(1200, 20)).toBe(true) // +20% tolerance
      expect(quantita.isWithinTolerance(1210, 20)).toBe(false) // +21% exceeds
    })
  })

  describe('equals', () => {
    it('should return true for same value and unit', () => {
      const q1 = Quantita.create(100, UnitaMisura.KG)
      const q2 = Quantita.create(100, UnitaMisura.KG)
      expect(q1.equals(q2)).toBe(true)
    })

    it('should return false for different values', () => {
      const q1 = Quantita.create(100, UnitaMisura.KG)
      const q2 = Quantita.create(200, UnitaMisura.KG)
      expect(q1.equals(q2)).toBe(false)
    })

    it('should return false for different units', () => {
      const q1 = Quantita.create(100, UnitaMisura.KG)
      const q2 = Quantita.create(100, UnitaMisura.LITRI)
      expect(q1.equals(q2)).toBe(false)
    })
  })

  describe('toString', () => {
    it('should return formatted string', () => {
      const quantita = Quantita.create(120, UnitaMisura.KG)
      expect(quantita.toString()).toBe('120 kg')
    })
  })
})
