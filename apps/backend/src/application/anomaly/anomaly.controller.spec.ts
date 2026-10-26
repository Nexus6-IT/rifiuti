import { ForbiddenException } from '@nestjs/common'
import { AnomalyController } from './anomaly.controller'

describe('AnomalyController — azienda selezionata', () => {
  const req = { tenantId: 'B', user: { id: 'u1', tenantId: 'A', role: 'ADMIN' } }
  let service: { detectAnomalies: jest.Mock }
  let controller: AnomalyController

  beforeEach(() => {
    service = { detectAnomalies: jest.fn().mockResolvedValue([]) }
    controller = new AnomalyController(service as any)
  })

  it("detect: usa l'azienda selezionata (non quella del token)", async () => {
    await controller.detect(req)
    expect(service.detectAnomalies).toHaveBeenCalledWith('B')
  })

  it('senza azienda determinabile: 403, nessuna lettura', async () => {
    await expect(controller.detect({ user: { id: 'u1' } })).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(service.detectAnomalies).not.toHaveBeenCalled()
  })
})
