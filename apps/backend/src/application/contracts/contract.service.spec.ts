import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ContractService } from './contract.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('ContractService', () => {
  let service: ContractService
  let prisma: any

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any
    prisma = {
      contract: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()
    service = module.get(ContractService)
  })

  describe('changeStatus (workflow)', () => {
    it('ammette DRAFT → PENDING_APPROVAL', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'DRAFT' })
      prisma.contract.update.mockResolvedValue({ id: 'c1', status: 'PENDING_APPROVAL' })

      const res = await service.changeStatus('t1', 'c1', 'PENDING_APPROVAL')
      expect(res.status).toBe('PENDING_APPROVAL')
      expect(prisma.contract.update).toHaveBeenCalled()
    })

    it('rifiuta una transizione non ammessa (DRAFT → ACTIVE)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'DRAFT' })
      await expect(service.changeStatus('t1', 'c1', 'ACTIVE')).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.contract.update).not.toHaveBeenCalled()
    })

    it('rifiuta transizioni da stato terminale (TERMINATED)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' })
      await expect(service.changeStatus('t1', 'c1', 'ACTIVE')).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('404 se il contratto non esiste', async () => {
      prisma.contract.findFirst.mockResolvedValue(null)
      await expect(service.changeStatus('t1', 'x', 'ACTIVE')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })
  })

  describe('getAutoFillForFir', () => {
    it('restituisce i dati del contratto attivo che copre il CER', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: 'c1',
        contractNumber: 'CTR-2026-001',
        counterpartyId: 'tr-1',
        counterpartyType: 'TRANSPORTER',
        pricingModel: 'PAY_BY_WEIGHT',
        basePrice: 120,
        unitOfMeasure: 'ton',
      })

      const fill = await service.getAutoFillForFir('t1', 'prod-1', '150101')

      expect(prisma.contract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            producerId: 'prod-1',
            status: 'ACTIVE',
            cerCodes: { has: '150101' },
          }),
        })
      )
      expect(fill).toMatchObject({
        contractId: 'c1',
        counterpartyId: 'tr-1',
        pricingModel: 'PAY_BY_WEIGHT',
        basePrice: 120,
      })
    })

    it('restituisce null se nessun contratto attivo copre il CER', async () => {
      prisma.contract.findFirst.mockResolvedValue(null)
      expect(await service.getAutoFillForFir('t1', 'prod-1', '999999')).toBeNull()
    })
  })

  it('create imposta stato DRAFT', async () => {
    prisma.contract.create.mockImplementation((args: any) => Promise.resolve(args.data))
    const res = await service.create('t1', {
      contractNumber: 'CTR-1',
      producerId: 'p1',
      counterpartyId: 'c1',
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      cerCodes: ['150101'],
      pricingModel: 'FLAT_RATE',
      startDate: new Date('2026-01-01'),
    })
    expect(res.status).toBe('DRAFT')
    expect(res.tenantId).toBe('t1')
  })
})
