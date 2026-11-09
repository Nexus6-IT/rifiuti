import { GetDashboardUseCase } from './get-dashboard.use-case'
import { AnalyticsService } from './analytics.service'
import { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('GetDashboardUseCase: stati nel periodo', () => {
  let analytics: Record<string, jest.Mock>
  let useCase: GetDashboardUseCase

  beforeEach(() => {
    analytics = {
      getTotalFIRs: jest.fn().mockResolvedValue(10),
      getFIRsByStatus: jest.fn(),
      getTotalWasteQuantity: jest.fn().mockResolvedValue(0),
      getWasteByCERCode: jest.fn().mockResolvedValue([]),
      getWasteByDestination: jest.fn().mockResolvedValue({ recyclingRate: 0 }),
      getRENTRISyncRate: jest.fn().mockResolvedValue({ rate: 0, total: 0, synced: 0 }),
      getSignatureCompletionRate: jest.fn().mockResolvedValue({ rate: 0, total: 0, completed: 0 }),
      getAverageSignatureTime: jest.fn().mockResolvedValue(0),
      getComplianceScore: jest.fn().mockResolvedValue({ score: 0, level: 'CRITICAL', factors: {} }),
      getOverdueFIRs: jest.fn().mockResolvedValue(0),
      getMonthOverMonthGrowth: jest
        .fn()
        .mockResolvedValue({ current: 0, previous: 0, percentage: 0 }),
      predictNextMonthVolume: jest.fn().mockResolvedValue(null),
      getTopProducers: jest.fn().mockResolvedValue([]),
      getTopCarriers: jest.fn().mockResolvedValue([]),
    }
    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggerService
    useCase = new GetDashboardUseCase(analytics as unknown as AnalyticsService, logger, {
      moduliAttivi: jest.fn().mockResolvedValue(['rentri']),
    } as unknown as ModuliAttiviService)
  })

  it('senza intervallo: una sola chiamata a getFIRsByStatus', async () => {
    analytics.getFIRsByStatus.mockResolvedValue({ COMPLETED: 4 })
    const r = await useCase.execute({ tenantId: 't' })
    expect(analytics.getFIRsByStatus).toHaveBeenCalledTimes(1)
    expect(analytics.getFIRsByStatus).toHaveBeenCalledWith('t')
    expect(r.status.breakdown).toEqual({ COMPLETED: 4 })
    expect(r.overview.completedFIRs).toBe(4)
  })

  it('con intervallo: overview dalla chiamata senza, status da quella con; nessun altro metodo lo riceve', async () => {
    const dateRange = { startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') }
    analytics.getFIRsByStatus.mockImplementation(async (_t: string, i?: unknown) =>
      i ? { COMPLETED: 1, DRAFT: 2 } : { COMPLETED: 9, DRAFT: 3 }
    )
    const r = await useCase.execute({ tenantId: 't', dateRange })
    expect(analytics.getFIRsByStatus).toHaveBeenCalledTimes(2)
    expect(analytics.getFIRsByStatus).toHaveBeenCalledWith('t')
    expect(analytics.getFIRsByStatus).toHaveBeenCalledWith('t', dateRange)
    expect(r.overview.completedFIRs).toBe(9)
    expect(r.overview.pendingFIRs).toBe(3)
    expect(r.status.breakdown).toEqual({ COMPLETED: 1, DRAFT: 2 })
    expect(r.status.chart).toEqual([
      { status: 'COMPLETED', count: 1 },
      { status: 'DRAFT', count: 2 },
    ])
    for (const [nome, fn] of Object.entries(analytics)) {
      if (nome === 'getFIRsByStatus') continue
      for (const call of fn.mock.calls) expect(call).not.toContainEqual(dateRange)
    }
  })
})
