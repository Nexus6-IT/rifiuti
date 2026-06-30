/**
 * CER Controller - TDD Tests
 */

import { Test, TestingModule } from '@nestjs/testing'
import { CERController } from './cer.controller'
import { CERCatalogService } from '../../domain/cer/services/cer-catalog.service'
import { CERCode } from '../../domain/cer/entities/cer-code.entity'

describe('CERController', () => {
  let controller: CERController
  let service: jest.Mocked<CERCatalogService>

  beforeEach(async () => {
    const mockService = {
      search: jest.fn(),
      getByCode: jest.fn(),
      getStatistics: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CERController],
      providers: [
        {
          provide: CERCatalogService,
          useValue: mockService,
        },
      ],
    }).compile()

    controller = module.get<CERController>(CERController)
    service = module.get(CERCatalogService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('search', () => {
    it('should search CER codes by keyword', async () => {
      const cer = CERCode.create({
        code: '13 02 05*',
        description: 'oli minerali per motori',
        isPericoloso: true,
        category: '13',
      })

      service.search.mockResolvedValue([cer])

      const result = await controller.search('olio')

      expect(result.length).toBe(1)
      expect(result[0].code).toBe('13 02 05*')
      expect(result[0].description).toContain('oli minerali')
      expect(service.search).toHaveBeenCalledWith('olio', {})
    })

    it('should apply pericoloso filter', async () => {
      const cer = CERCode.create({
        code: '13 02 05*',
        description: 'oli pericolosi',
        isPericoloso: true,
        category: '13',
      })

      service.search.mockResolvedValue([cer])

      const result = await controller.search('olio', 'true')

      expect(result.length).toBe(1)
      expect(service.search).toHaveBeenCalledWith('olio', { pericoloso: true })
    })

    it('should apply category filter', async () => {
      const cer = CERCode.create({
        code: '13 01 01*',
        description: 'test',
        isPericoloso: true,
        category: '13',
      })

      service.search.mockResolvedValue([cer])

      await controller.search('test', undefined, '13')

      expect(service.search).toHaveBeenCalledWith('test', { category: '13' })
    })

    it('should return empty array if no results', async () => {
      service.search.mockResolvedValue([])

      const result = await controller.search('nonexistent')

      expect(result.length).toBe(0)
    })
  })

  describe('getByCode', () => {
    it('should return CER code by code', async () => {
      const cer = CERCode.create({
        code: '13 02 05*',
        description: 'oli minerali',
        isPericoloso: true,
        category: '13',
      })

      service.getByCode.mockResolvedValue(cer)

      const result = await controller.getByCode('13 02 05*')

      expect(result).not.toBeNull()
      expect(result?.code).toBe('13 02 05*')
      expect(service.getByCode).toHaveBeenCalledWith('13 02 05*')
    })

    it('should return null if code not found', async () => {
      service.getByCode.mockResolvedValue(null)

      const result = await controller.getByCode('99 99 99')

      expect(result).toBeNull()
    })
  })

  describe('getStatistics', () => {
    it('should return catalog statistics', async () => {
      const stats = {
        total: 842,
        pericolosi: 405,
        nonPericolosi: 437,
      }

      service.getStatistics.mockResolvedValue(stats)

      const result = await controller.getStatistics()

      expect(result.total).toBe(842)
      expect(result.pericolosi).toBe(405)
      expect(result.nonPericolosi).toBe(437)
    })
  })
})
