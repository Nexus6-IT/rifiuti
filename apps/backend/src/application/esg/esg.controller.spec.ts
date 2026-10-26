import { ForbiddenException } from '@nestjs/common'
import { EsgController } from './esg.controller'

describe('EsgController — azienda selezionata', () => {
  const req = { tenantId: 'B', user: { id: 'u1', tenantId: 'A', role: 'ADMIN' } }
  let service: { getEnvironmentalReport: jest.Mock }
  let controller: EsgController

  beforeEach(() => {
    service = { getEnvironmentalReport: jest.fn().mockResolvedValue({}) }
    controller = new EsgController(service as any)
  })

  it("report: usa l'azienda selezionata (non quella del token)", async () => {
    await controller.getReport(req, '2026-01-01', '2026-02-01')

    expect(service.getEnvironmentalReport).toHaveBeenCalledWith('B', {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-02-01'),
    })
  })

  it('senza azienda determinabile: 403, nessuna lettura', async () => {
    await expect(controller.getReport({ user: { id: 'u1' } })).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(service.getEnvironmentalReport).not.toHaveBeenCalled()
  })
})
