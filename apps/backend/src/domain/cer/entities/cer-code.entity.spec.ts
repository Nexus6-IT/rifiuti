/**
 * CERCode Entity - TDD Tests
 */

import { CERCode } from './cer-code.entity'

describe('CERCode Entity', () => {
  describe('create', () => {
    it('should create CER code with valid format', () => {
      const cer = CERCode.create({
        code: '13 02 05*',
        description: 'oli minerali per motori, ingranaggi e lubrificazione, non clorurati',
        isPericoloso: true,
        category: '13',
        subcategory: '13 02',
      })

      expect(cer.id).toBeDefined()
      expect(cer.code).toBe('13 02 05*')
      expect(cer.description).toContain('oli minerali')
      expect(cer.isPericoloso).toBe(true)
      expect(cer.category).toBe('13')
      expect(cer.categoryNumber).toBe(13)
    })

    it('should create non-dangerous CER code without asterisk', () => {
      const cer = CERCode.create({
        code: '15 01 01',
        description: 'imballaggi in carta e cartone',
        isPericoloso: false,
        category: '15',
      })

      expect(cer.code).toBe('15 01 01')
      expect(cer.isPericoloso).toBe(false)
    })

    it('should throw error for invalid code format (missing spaces)', () => {
      expect(() =>
        CERCode.create({
          code: '130205*',
          description: 'test',
          isPericoloso: true,
          category: '13',
        })
      ).toThrow('Invalid CER code format')
    })

    it('should throw error for invalid code format (wrong pattern)', () => {
      expect(() =>
        CERCode.create({
          code: '13 2 05*',
          description: 'test',
          isPericoloso: true,
          category: '13',
        })
      ).toThrow('Invalid CER code format')
    })

    it('should extract category number from code', () => {
      const cer = CERCode.create({
        code: '20 03 01',
        description: 'rifiuti urbani non differenziati',
        isPericoloso: false,
        category: '20',
      })

      expect(cer.categoryNumber).toBe(20)
    })

    it('should default subcategory to null if not provided', () => {
      const cer = CERCode.create({
        code: '01 01 01',
        description: 'test',
        isPericoloso: false,
        category: '01',
      })

      expect(cer.subcategory).toBeNull()
    })
  })

  describe('reconstitute', () => {
    it('should reconstitute CER code from persistence', () => {
      const cer = CERCode.reconstitute({
        id: 'existing-id',
        code: '13 02 05*',
        description: 'oli minerali',
        isPericoloso: true,
        category: '13',
        subcategory: '13 02',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-15'),
      })

      expect(cer.id).toBe('existing-id')
      expect(cer.code).toBe('13 02 05*')
      expect(cer.createdAt).toEqual(new Date('2025-01-01'))
    })
  })

  describe('equals', () => {
    it('should return true for same CER code', () => {
      const cer1 = CERCode.create({
        code: '13 02 05*',
        description: 'test',
        isPericoloso: true,
        category: '13',
      })

      const cer2 = CERCode.create({
        code: '13 02 05*',
        description: 'different description',
        isPericoloso: true,
        category: '13',
      })

      expect(cer1.equals(cer2)).toBe(true)
    })

    it('should return false for different CER codes', () => {
      const cer1 = CERCode.create({
        code: '13 02 05*',
        description: 'test',
        isPericoloso: true,
        category: '13',
      })

      const cer2 = CERCode.create({
        code: '15 01 01',
        description: 'test',
        isPericoloso: false,
        category: '15',
      })

      expect(cer1.equals(cer2)).toBe(false)
    })
  })
})
