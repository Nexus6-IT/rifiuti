/**
 * CER Catalog Service - TDD Tests
 */

import { CERCatalogService } from './cer-catalog.service'
import { ICERRepository } from '../repositories/cer-repository.interface'
import { CERCode } from '../entities/cer-code.entity'

// Mock Repository
class MockCERRepository implements ICERRepository {
  private cers: Map<string, CERCode> = new Map()

  async findByCode(code: string): Promise<CERCode | null> {
    return this.cers.get(code) || null
  }

  async findById(id: string): Promise<CERCode | null> {
    for (const cer of this.cers.values()) {
      if (cer.id === id) return cer
    }
    return null
  }

  async search(keyword: string, filters?: any): Promise<CERCode[]> {
    const results: CERCode[] = []
    for (const cer of this.cers.values()) {
      if (cer.description.toLowerCase().includes(keyword.toLowerCase())) {
        if (filters?.pericoloso !== undefined && cer.isPericoloso !== filters.pericoloso) {
          continue
        }
        results.push(cer)
      }
    }
    return results.sort((a, b) => a.code.localeCompare(b.code))
  }

  async findByCategory(category: string): Promise<CERCode[]> {
    const results: CERCode[] = []
    for (const cer of this.cers.values()) {
      if (cer.category === category) {
        results.push(cer)
      }
    }
    return results
  }

  async findAllPericolosi(): Promise<CERCode[]> {
    const results: CERCode[] = []
    for (const cer of this.cers.values()) {
      if (cer.isPericoloso) {
        results.push(cer)
      }
    }
    return results
  }

  async findPaginated(page: number, limit: number): Promise<{ items: CERCode[]; total: number }> {
    const all = Array.from(this.cers.values())
    const start = (page - 1) * limit
    return { items: all.slice(start, start + limit), total: all.length }
  }

  async save(cer: CERCode): Promise<void> {
    this.cers.set(cer.code, cer)
  }

  async saveMany(cers: CERCode[]): Promise<void> {
    for (const cer of cers) {
      this.cers.set(cer.code, cer)
    }
  }

  async count(): Promise<number> {
    return this.cers.size
  }

  async exists(code: string): Promise<boolean> {
    return this.cers.has(code)
  }

  // Test helper
  clear() {
    this.cers.clear()
  }
}

describe('CERCatalogService', () => {
  let service: CERCatalogService
  let repository: MockCERRepository

  beforeEach(() => {
    repository = new MockCERRepository()
    service = new CERCatalogService(repository)
  })

  describe('search', () => {
    beforeEach(async () => {
      // Setup test data
      const cer1 = CERCode.create({
        code: '13 02 05*',
        description: 'olio minerale per motori, ingranaggi e lubrificazione, non clorurato',
        isPericoloso: true,
        category: '13',
      })
      const cer2 = CERCode.create({
        code: '13 02 06*',
        description: 'olio sintetico per motori, ingranaggi e lubrificazione',
        isPericoloso: true,
        category: '13',
      })
      const cer3 = CERCode.create({
        code: '15 01 01',
        description: 'imballaggi in carta e cartone',
        isPericoloso: false,
        category: '15',
      })
      await repository.saveMany([cer1, cer2, cer3])
    })

    it('should search CER codes by keyword', async () => {
      const results = await service.search('olio')

      expect(results.length).toBe(2)
      expect(results[0].code).toBe('13 02 05*')
      expect(results[1].code).toBe('13 02 06*')
    })

    it('should search case-insensitive', async () => {
      const results = await service.search('OLIO')

      expect(results.length).toBe(2)
    })

    it('should filter by pericoloso', async () => {
      const results = await service.search('olio', { pericoloso: true })

      expect(results.length).toBe(2)
      expect(results.every(cer => cer.isPericoloso)).toBe(true)
    })

    it('should throw error for empty keyword', async () => {
      ;(await expect(service.search('')).rejects.toThrow('Search keyword cannot be empty')) as any
    })

    it('should trim whitespace from keyword', async () => {
      const results = await service.search('  olio  ')

      expect(results.length).toBe(2)
    })
  })

  describe('getByCode', () => {
    it('should get CER code by code', async () => {
      const cer = CERCode.create({
        code: '13 02 05*',
        description: 'oli minerali',
        isPericoloso: true,
        category: '13',
      })
      await repository.save(cer)

      const result = await service.getByCode('13 02 05*')

      expect(result).not.toBeNull()
      expect(result?.code).toBe('13 02 05*')
    })

    it('should return null if code not found', async () => {
      const result = await service.getByCode('99 99 99')

      expect(result).toBeNull()
    })
  })

  describe('validateCode', () => {
    it('should return true if code exists', async () => {
      const cer = CERCode.create({
        code: '13 02 05*',
        description: 'oli minerali',
        isPericoloso: true,
        category: '13',
      })
      await repository.save(cer)

      const exists = await service.validateCode('13 02 05*')

      expect(exists).toBe(true)
    })

    it('should return false if code does not exist', async () => {
      const exists = await service.validateCode('99 99 99')

      expect(exists).toBe(false)
    })
  })

  describe('getAllPericolosi', () => {
    it('should return all dangerous waste codes', async () => {
      const cer1 = CERCode.create({
        code: '13 02 05*',
        description: 'oli pericolosi',
        isPericoloso: true,
        category: '13',
      })
      const cer2 = CERCode.create({
        code: '15 01 01',
        description: 'carta',
        isPericoloso: false,
        category: '15',
      })
      await repository.saveMany([cer1, cer2])

      const results = await service.getAllPericolosi()

      expect(results.length).toBe(1)
      expect(results[0].code).toBe('13 02 05*')
    })
  })

  describe('getByCategory', () => {
    it('should get CER codes by category', async () => {
      const cer1 = CERCode.create({
        code: '13 01 01*',
        description: 'test1',
        isPericoloso: true,
        category: '13',
      })
      const cer2 = CERCode.create({
        code: '13 02 05*',
        description: 'test2',
        isPericoloso: true,
        category: '13',
      })
      const cer3 = CERCode.create({
        code: '15 01 01',
        description: 'test3',
        isPericoloso: false,
        category: '15',
      })
      await repository.saveMany([cer1, cer2, cer3])

      const results = await service.getByCategory('13')

      expect(results.length).toBe(2)
    })

    it('should throw error for invalid category format', async () => {
      ;(await expect(service.getByCategory('1')).rejects.toThrow('Invalid category format')) as any
      ;(await expect(service.getByCategory('ABC')).rejects.toThrow(
        'Invalid category format'
      )) as any
    })
  })

  describe('importFromCSV', () => {
    it('should import CER codes from CSV records', async () => {
      const csvRecords = [
        { code: '13 02 05*', description: 'oli minerali', category: '13' },
        { code: '15 01 01', description: 'carta', category: '15' },
      ]

      const result = await service.importFromCSV(csvRecords)

      expect(result.imported).toBe(2)
      expect(result.skipped).toBe(0)
      expect(result.errors.length).toBe(0)

      const count = await repository.count()
      expect(count).toBe(2)
    })

    it('should skip existing CER codes', async () => {
      const existing = CERCode.create({
        code: '13 02 05*',
        description: 'existing',
        isPericoloso: true,
        category: '13',
      })
      await repository.save(existing)

      const csvRecords = [
        { code: '13 02 05*', description: 'duplicate', category: '13' },
        { code: '15 01 01', description: 'new', category: '15' },
      ]

      const result = await service.importFromCSV(csvRecords)

      expect(result.imported).toBe(1)
      expect(result.skipped).toBe(1)
    })

    it('should capture errors for invalid records', async () => {
      const csvRecords = [
        { code: 'INVALID', description: 'test', category: '13' },
        { code: '15 01 01', description: 'valid', category: '15' },
      ]

      const result = await service.importFromCSV(csvRecords)

      expect(result.imported).toBe(1)
      expect(result.errors.length).toBe(1)
      expect(result.errors[0]).toContain('INVALID')
    })

    it('should auto-detect dangerous waste from asterisk', async () => {
      const csvRecords = [{ code: '13 02 05*', description: 'dangerous oil', category: '13' }]

      await service.importFromCSV(csvRecords)

      const cer = await repository.findByCode('13 02 05*')
      expect(cer?.isPericoloso).toBe(true)
    })
  })

  describe('getStatistics', () => {
    it('should return catalog statistics', async () => {
      const cer1 = CERCode.create({
        code: '13 02 05*',
        description: 'pericoloso',
        isPericoloso: true,
        category: '13',
      })
      const cer2 = CERCode.create({
        code: '15 01 01',
        description: 'non pericoloso',
        isPericoloso: false,
        category: '15',
      })
      await repository.saveMany([cer1, cer2])

      const stats = await service.getStatistics()

      expect(stats.total).toBe(2)
      expect(stats.pericolosi).toBe(1)
      expect(stats.nonPericolosi).toBe(1)
    })
  })
})
