import { Test, TestingModule } from '@nestjs/testing'
import { AnomalyDetectionService } from './anomaly-detection.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService
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
      fIR: { findMany: jest.fn() },
      cERCode: { findMany: jest.fn() },
      wasteMovement: { groupBy: jest.fn() },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalyDetectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()
    service = module.get(AnomalyDetectionService)
  })

  function setup(firs: any[], catalog: string[], movements: any[] = []) {
    prisma.fIR.findMany.mockResolvedValue(firs)
    prisma.cERCode.findMany.mockResolvedValue(catalog.map(code => ({ code })))
    prisma.wasteMovement.groupBy.mockResolvedValue(movements)
  }

  it('non segnala nulla per un FIR valido', async () => {
    setup(
      [
        {
          id: 'f1',
          firNumber: 'FIR-1',
          cerCode: '150101',
          quantity: 100,
          wasteDescription: 'carta',
        },
      ],
      ['15 01 01']
    )
    expect(await service.detectAnomalies('t1')).toEqual([])
  })

  it('segnala CER non in catalogo, quantità non positiva e descrizione mancante', async () => {
    setup(
      [{ id: 'f1', firNumber: 'FIR-1', cerCode: '999999', quantity: 0, wasteDescription: '' }],
      ['150101']
    )
    const types = (await service.detectAnomalies('t1')).map(a => a.type)
    expect(types).toContain('INVALID_CER')
    expect(types).toContain('NON_POSITIVE_QUANTITY')
    expect(types).toContain('MISSING_DESCRIPTION')
  })

  it('segnala quantità eccessiva oltre soglia', async () => {
    setup(
      [
        {
          id: 'f1',
          firNumber: 'FIR-1',
          cerCode: '150101',
          quantity: 5_000_000,
          wasteDescription: 'x',
        },
      ],
      ['150101']
    )
    const anomalies = await service.detectAnomalies('t1', { maxQuantityKg: 1_000_000 })
    expect(anomalies.find(a => a.type === 'EXCESSIVE_QUANTITY')).toBeDefined()
  })

  it('segnala giacenza impossibile (scarico > carico)', async () => {
    setup(
      [],
      ['150101'],
      [
        { cerCode: '150101', type: 'CARICO', _sum: { quantity: 10 } },
        { cerCode: '150101', type: 'SCARICO', _sum: { quantity: 40 } },
      ]
    )
    const anomalies = await service.detectAnomalies('t1')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({ type: 'NEGATIVE_STOCK', cerCode: '150101' })
  })
})
