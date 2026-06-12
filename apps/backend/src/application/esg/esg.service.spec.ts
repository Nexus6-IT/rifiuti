import { Test, TestingModule } from '@nestjs/testing'
import { EsgService } from './esg.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { co2FactorForCer } from './emission-factors'

/**
 * Verifica gli indicatori ESG derivati dai FIR (recupero/smaltimento):
 * tasso di recupero, kg deviati da discarica e CO₂ evitata stimata.
 */
describe('EsgService', () => {
  let service: EsgService
  let prisma: PrismaService

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EsgService,
        { provide: PrismaService, useValue: { fIR: { groupBy: jest.fn() } } },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()

    service = module.get(EsgService)
    prisma = module.get(PrismaService)
  })

  it('aggrega recupero/smaltimento e calcola recyclingRate, kg deviati e CO₂ evitata', async () => {
    ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
      { cerCode: '150101', wasteOperationType: 'RECOVERY', _sum: { quantity: 100 } }, // cap.15 → factor 1.2
      { cerCode: '150101', wasteOperationType: 'DISPOSAL', _sum: { quantity: 20 } },
      { cerCode: '170504', wasteOperationType: 'RECOVERY', _sum: { quantity: 50 } }, // cap.17 → factor 0.05
    ])

    const report = await service.getEnvironmentalReport('tenant-1')

    expect(report.totals.recoveryKg).toBe(150)
    expect(report.totals.disposalKg).toBe(20)
    expect(report.totals.producedKg).toBe(170)
    expect(report.totals.recyclingRate).toBeCloseTo(150 / 170, 5)
    // kg deviati da discarica = quota a recupero
    expect(report.landfillDivertedKg).toBe(150)
    // CO₂ evitata = 100*1.2 + 50*0.05 = 122.5
    expect(report.co2AvoidedKg).toBeCloseTo(100 * co2FactorForCer('150101') + 50 * co2FactorForCer('170504'), 5)
    expect(report.co2AvoidedKg).toBeCloseTo(122.5, 5)

    // breakdown ordinato per CO₂ evitata decrescente
    expect(report.byCer[0].cerCode).toBe('150101')
    expect(report.byCer).toHaveLength(2)
  })

  it('filtra per tenant e periodo (gte/lte su createdAt)', async () => {
    ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([])
    const from = new Date('2026-01-01')
    const to = new Date('2026-12-31')

    await service.getEnvironmentalReport('tenant-xyz', { startDate: from, endDate: to })

    const args = (prisma.fIR.groupBy as jest.Mock).mock.calls[0][0]
    expect(args.where.tenantId).toBe('tenant-xyz')
    expect(args.where.createdAt.gte).toEqual(from)
    expect(args.where.createdAt.lte).toEqual(to)
    expect(args.by).toEqual(['cerCode', 'wasteOperationType'])
  })

  it('non divide per zero quando non ci sono FIR', async () => {
    ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([])

    const report = await service.getEnvironmentalReport('tenant-1')

    expect(report.totals.producedKg).toBe(0)
    expect(report.totals.recyclingRate).toBe(0)
    expect(report.co2AvoidedKg).toBe(0)
    expect(report.landfillDivertedKg).toBe(0)
    expect(report.byCer).toEqual([])
  })
})
