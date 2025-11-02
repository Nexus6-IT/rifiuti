/**
 * FIR Controller - TDD Tests
 */

import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { FIRController } from './fir.controller'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { ListFIRsQueryHandler } from '../../application/fir/queries/list-firs.handler'
import { FIR, FIRStato } from '../../domain/fir/aggregates/fir.aggregate'
import { Result } from '../../core/application/result'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { CreateFIRDto } from './dtos/create-fir.dto'
import { PaginatedResult } from '../../application/fir/queries/list-firs.query'

describe('FIRController', () => {
  let controller: FIRController
  let createFIRUseCase: jest.Mocked<CreateFIRUseCase>
  let listFIRsQueryHandler: jest.Mocked<ListFIRsQueryHandler>

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    tenantId: 'tenant-producer-123',
    tenantIds: ['tenant-producer-123'],
    role: 'ADMIN',
    permissions: ['fir:*'],
  }

  beforeEach(async () => {
    const mockUseCase = {
      execute: jest.fn(),
    }

    const mockListHandler = {
      execute: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FIRController],
      providers: [
        {
          provide: CreateFIRUseCase,
          useValue: mockUseCase,
        },
        {
          provide: ListFIRsQueryHandler,
          useValue: mockListHandler,
        },
      ],
    }).compile()

    controller = module.get<FIRController>(FIRController)
    createFIRUseCase = module.get(CreateFIRUseCase)
    listFIRsQueryHandler = module.get(ListFIRsQueryHandler)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('create', () => {
    const validDto: CreateFIRDto = {
      produttoreId: 'tenant-producer-123',
      rifiuto: {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
        statoFisico: 'Liquido',
      },
      trasportatoreId: 'tenant-transporter-456',
      destinatarioId: 'tenant-destination-789',
    }

    it('should create FIR and return response DTO', async () => {
      const fir = FIR.create({
        produttoreId: validDto.produttoreId,
        rifiuto: validDto.rifiuto,
        trasportatoreId: validDto.trasportatoreId,
        destinatarioId: validDto.destinatarioId,
      })

      createFIRUseCase.execute.mockResolvedValue(Result.ok(fir))

      const result = await controller.create(validDto, mockUser)

      expect(result.id).toBe(fir.id)
      expect(result.stato).toBe(FIRStato.BOZZA)
      expect(result.produttoreId).toBe('tenant-producer-123')
      expect(result.rifiuto.cerCode).toBe('13 02 05*')
      expect(result.rifiuto.quantita).toBe(120)
    })

    it('should call use case with correct command', async () => {
      const fir = FIR.create({
        produttoreId: validDto.produttoreId,
        rifiuto: validDto.rifiuto,
        trasportatoreId: validDto.trasportatoreId,
        destinatarioId: validDto.destinatarioId,
      })

      createFIRUseCase.execute.mockResolvedValue(Result.ok(fir))

      await controller.create(validDto, mockUser)

      expect(createFIRUseCase.execute).toHaveBeenCalledWith(
        (expect as any).objectContaining({
          produttoreId: 'tenant-producer-123',
          trasportatoreId: 'tenant-transporter-456',
          destinatarioId: 'tenant-destination-789',
          userId: 'user-123',
        })
      )
    })

    it('should throw BadRequestException if use case fails', async () => {
      createFIRUseCase.execute.mockResolvedValue(
        Result.fail('CER code not found: 99 99 99')
      )

      await expect(controller.create(validDto, mockUser)).rejects.toThrow(
        BadRequestException
      )

      await expect(controller.create(validDto, mockUser)).rejects.toThrow(
        'CER code not found: 99 99 99'
      )
    })

    it('should include user ID from authenticated user', async () => {
      const fir = FIR.create({
        produttoreId: validDto.produttoreId,
        rifiuto: validDto.rifiuto,
        trasportatoreId: validDto.trasportatoreId,
        destinatarioId: validDto.destinatarioId,
      })

      createFIRUseCase.execute.mockResolvedValue(Result.ok(fir))

      await controller.create(validDto, mockUser)

      expect(createFIRUseCase.execute).toHaveBeenCalledWith(
        (expect as any).objectContaining({
          userId: 'user-123',
        })
      )
    })
  })

  describe('list', () => {
    const createMockFIR = (): FIR => {
      return FIR.create({
        produttoreId: 'tenant-producer-123',
        rifiuto: {
          cerCode: '13 02 05*',
          quantita: 120,
          unitaMisura: UnitaMisura.KG,
        },
        trasportatoreId: 'tenant-transporter-456',
        destinatarioId: 'tenant-destination-789',
      })
    }

    it('should return paginated FIRs', async () => {
      const fir1 = createMockFIR()
      const fir2 = createMockFIR()

      const paginatedResult: PaginatedResult<FIR> = {
        items: [fir1, fir2],
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      }

      listFIRsQueryHandler.execute.mockResolvedValue(Result.ok(paginatedResult))

      const result = await controller.list({}, mockUser)

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(10)
    })

    it('should apply pagination parameters', async () => {
      const paginatedResult: PaginatedResult<FIR> = {
        items: [],
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      }

      listFIRsQueryHandler.execute.mockResolvedValue(Result.ok(paginatedResult))

      await controller.list({ page: '2', limit: '10' }, mockUser)

      expect(listFIRsQueryHandler.execute).toHaveBeenCalledWith(
        (expect as any).objectContaining({
          tenantId: 'tenant-producer-123',
          userId: 'user-123',
          pagination: { page: 2, limit: 10 },
        })
      )
    })

    it('should apply stato filter', async () => {
      const paginatedResult: PaginatedResult<FIR> = {
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      }

      listFIRsQueryHandler.execute.mockResolvedValue(Result.ok(paginatedResult))

      await controller.list({ stato: FIRStato.EMESSO }, mockUser)

      expect(listFIRsQueryHandler.execute).toHaveBeenCalledWith(
        (expect as any).objectContaining({
          filters: {
            stato: FIRStato.EMESSO,
          },
        })
      )
    })

    it('should apply cerCode filter', async () => {
      const paginatedResult: PaginatedResult<FIR> = {
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      }

      listFIRsQueryHandler.execute.mockResolvedValue(Result.ok(paginatedResult))

      await controller.list({ cerCode: '13 02 05*' }, mockUser)

      expect(listFIRsQueryHandler.execute).toHaveBeenCalledWith(
        (expect as any).objectContaining({
          filters: {
            cerCode: '13 02 05*',
          },
        })
      )
    })

    it('should use tenant ID from authenticated user', async () => {
      const paginatedResult: PaginatedResult<FIR> = {
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      }

      listFIRsQueryHandler.execute.mockResolvedValue(Result.ok(paginatedResult))

      await controller.list({}, mockUser)

      expect(listFIRsQueryHandler.execute).toHaveBeenCalledWith(
        (expect as any).objectContaining({
          tenantId: 'tenant-producer-123',
          userId: 'user-123',
        })
      )
    })

    it('should throw BadRequestException if query fails', async () => {
      listFIRsQueryHandler.execute.mockResolvedValue(Result.fail('Invalid filter parameters'))

      await expect(controller.list({}, mockUser)).rejects.toThrow(BadRequestException) as any;
      await expect(controller.list({}, mockUser)).rejects.toThrow('Invalid filter parameters') as any;
    })
  })
})
