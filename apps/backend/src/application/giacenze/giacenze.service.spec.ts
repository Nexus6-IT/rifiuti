import { Test, TestingModule } from '@nestjs/testing'
import { GiacenzeService } from './giacenze.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('GiacenzeService', () => {
  let service: GiacenzeService
  let prisma: any

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any
    prisma = { wasteMovement: { groupBy: jest.fn() } }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiacenzeService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()
    service = module.get(GiacenzeService)
  })

  /** Instrada le due groupBy: per [cerCode,type] e per [cerCode] (min data carico). */
  function mockGroupBy(byType: any[], oldest: any[]) {
    prisma.wasteMovement.groupBy.mockImplementation((args: any) => {
      if (args.by.includes('type')) return Promise.resolve(byType)
      return Promise.resolve(oldest)
    })
  }

  it('calcola la giacenza per CER (carico - scarico, clamp a 0)', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', _sum: { quantity: 30 } },
        { cerCode: '170504', type: 'CARICO', _sum: { quantity: 10 } },
        { cerCode: '170504', type: 'SCARICO', _sum: { quantity: 25 } }, // scarico > carico
      ],
      [
        { cerCode: '150101', _min: { movementDate: new Date('2026-01-01') } },
        { cerCode: '170504', _min: { movementDate: new Date('2026-05-01') } },
      ]
    )

    const giacenze = await service.getGiacenze('tenant-1')

    const cer15 = giacenze.find(g => g.cerCode === '150101')!
    expect(cer15.giacenzaKg).toBe(70)
    expect(cer15.oldestCaricoDate).toEqual(new Date('2026-01-01'))
    const cer17 = giacenze.find(g => g.cerCode === '170504')!
    expect(cer17.giacenzaKg).toBe(0) // clamp: 10-25 → 0
  })

  it('alza alert DURATION quando il carico più vecchio supera i giorni massimi', async () => {
    mockGroupBy(
      [{ cerCode: '150101', type: 'CARICO', _sum: { quantity: 100 } }],
      [{ cerCode: '150101', _min: { movementDate: new Date('2026-01-01') } }]
    )

    const alerts = await service.getDepositoTemporaneoAlerts(
      'tenant-1',
      { maxDurationDays: 90, maxQuantityKg: 1_000_000 },
      new Date('2026-06-01') // ~151 giorni dopo
    )

    expect(alerts).toHaveLength(1)
    expect(alerts[0].reasons).toContain('DURATION')
    expect(alerts[0].durationDays).toBeGreaterThan(90)
  })

  it('alza alert QUANTITY quando la giacenza supera la soglia in kg', async () => {
    mockGroupBy(
      [{ cerCode: '150101', type: 'CARICO', _sum: { quantity: 50000 } }],
      [{ cerCode: '150101', _min: { movementDate: new Date('2026-05-30') } }]
    )

    const alerts = await service.getDepositoTemporaneoAlerts(
      'tenant-1',
      { maxDurationDays: 90, maxQuantityKg: 30000 },
      new Date('2026-06-01')
    )

    expect(alerts).toHaveLength(1)
    expect(alerts[0].reasons).toEqual(['QUANTITY'])
    expect(alerts[0].giacenzaKg).toBe(50000)
  })

  it('nessun alert se la giacenza è entro le soglie', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', _sum: { quantity: 100 } }, // giacenza 0
      ],
      [{ cerCode: '150101', _min: { movementDate: new Date('2020-01-01') } }]
    )

    const alerts = await service.getDepositoTemporaneoAlerts('tenant-1')
    expect(alerts).toEqual([])
  })
})
