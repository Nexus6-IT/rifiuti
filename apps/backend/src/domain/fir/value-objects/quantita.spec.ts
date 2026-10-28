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
