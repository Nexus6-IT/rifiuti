import { ForbiddenException } from '@nestjs/common'
import { RENTRISyncController } from './rentri-sync.controller'

describe('RENTRISyncController.syncFIR', () => {
  const queue = { addSyncJob: jest.fn() }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const logger = { setContext: jest.fn(), info: jest.fn(), error: jest.fn() }
  let controller: RENTRISyncController
  // Azienda selezionata (req.tenantId) diversa da quella primaria del token (user.tenantId).
  const req = {
    tenantId: 'tenant-sel',
    user: { id: 'user-1', role: 'ADMIN', tenantId: 'tenant-primario' },
  }

  beforeEach(() => {
    jest.resetAllMocks()
    queue.addSyncJob.mockResolvedValue('job-1')
    controller = new RENTRISyncController(
      {} as any,
      {} as any,
      {} as any,
      queue as any,
      {} as any,
      logger as any,
      ruolo as any
    )
  })

  it("confermaNuovaTrasmissione da utente non ADMIN nell'azienda selezionata: 403", async () => {
    // Il token dice ADMIN (azienda primaria), ma nell'azienda selezionata è OPERATOR.
    ruolo.ruoloEffettivo.mockResolvedValue('OPERATOR')

    await expect(
      controller.syncFIR('fir-1', 'user-1', { confermaNuovaTrasmissione: true }, req)
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'tenant-sel')
    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })

  it("da ADMIN: addSyncJob con confermaNuovaTrasmissione true, sull'azienda selezionata", async () => {
    ruolo.ruoloEffettivo.mockResolvedValue('ADMIN')

    await controller.syncFIR('fir-1', 'user-1', { confermaNuovaTrasmissione: true }, req)

    expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'tenant-sel')
    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        firId: 'fir-1',
        tenantId: 'tenant-sel',
        confermaNuovaTrasmissione: true,
      })
    )
  })

  it("senza conferma: nessun controllo di ruolo, nessun flag, job sull'azienda selezionata", async () => {
    await controller.syncFIR('fir-1', 'user-1', {}, req)

    expect(ruolo.ruoloEffettivo).not.toHaveBeenCalled()
    const arg = queue.addSyncJob.mock.calls[0][0]
    expect(arg.tenantId).toBe('tenant-sel')
    expect(arg.confermaNuovaTrasmissione).toBeFalsy()
  })
})
