import { BadRequestException } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { DashboardData } from '../../application/analytics/get-dashboard.use-case'

describe('DashboardController: validazione delle date', () => {
  const useCase = { execute: jest.fn().mockResolvedValue({}) }
  const controller = new DashboardController(useCase as never)
  const req = { tenantId: '11111111-1111-4111-8111-111111111111' }

  beforeEach(() => useCase.execute.mockClear())

  it('startDate non valida -> 400', async () => {
    await expect(controller.getDashboard(req, 'abc', '2026-11-30')).rejects.toThrow(
      BadRequestException
    )
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('startDate > endDate -> 400', async () => {
    await expect(controller.getDashboard(req, '2026-12-01', '2026-11-01')).rejects.toThrow(
      'Intervallo di date non valido'
    )
  })

  it('una sola delle due date -> 400, non ignorata in silenzio', async () => {
    await expect(controller.getDashboard(req, 'abc', undefined)).rejects.toThrow(
      BadRequestException
    )
    await expect(controller.getDashboard(req, undefined, '2026-11-30')).rejects.toThrow(
      BadRequestException
    )
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('nessuna data -> nessun intervallo; intervallo valido -> passato allo use case', async () => {
    await controller.getDashboard(req)
    expect(useCase.execute.mock.calls[0][0].dateRange).toBeUndefined()
    await controller.getDashboard(req, '2026-11-01', '2026-11-30')
    expect(useCase.execute.mock.calls[1][0].dateRange.startDate).toEqual(new Date('2026-11-01'))
  })
})

describe('DashboardController: export CSV', () => {
  const controller = new DashboardController({} as never)
  const csv = (nextMonth: number | null): string =>
    (controller as unknown as { generateCSV(d: DashboardData): string }).generateCSV({
      overview: { totalFIRs: 0, totalWasteKg: 0, completedFIRs: 0, pendingFIRs: 0, overdueFIRs: 0 },
      status: { breakdown: {}, chart: [] },
      waste: { byCERCode: [] },
      compliance: { score: 0, level: 'CRITICAL' },
      trends: {
        monthOverMonth: { current: 0, previous: 0, percentage: 0 },
        prediction: { nextMonth },
      },
    } as unknown as DashboardData)

  it('previsione null -> cella vuota, mai il testo null', () => {
    const testo = csv(null)
    expect(testo).toContain('Next Month Prediction,')
    expect(testo).not.toContain('null')
    expect(testo.split('\n').pop()).toBe('Next Month Prediction,')
  })

  it('previsione 0 resta 0; 22 resta 22', () => {
    expect(csv(0).split('\n').pop()).toBe('Next Month Prediction,0')
    expect(csv(22).split('\n').pop()).toBe('Next Month Prediction,22')
  })
})
