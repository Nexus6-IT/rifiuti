import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { RENTRISyncController } from './rentri-sync.controller'
import { DomainException } from '../../domain/shared/domain-exception'

describe('RENTRISyncController.syncFIR', () => {
  const queue = { addSyncJob: jest.fn() }
  const ruolo = { ruoloEffettivo: jest.fn() }
  const riapri = { execute: jest.fn() }
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
    riapri.execute.mockResolvedValue(undefined)
    controller = new RENTRISyncController(
      {} as any,
      {} as any,
      {} as any,
      queue as any,
      {} as any,
      logger as any,
      ruolo as any,
      riapri as any
    )
  })

  it("confermaNuovaTrasmissione da utente non ADMIN nell'azienda selezionata: 403", async () => {
    // Il token dice ADMIN (azienda primaria), ma nell'azienda selezionata è OPERATOR.
    ruolo.ruoloEffettivo.mockResolvedValue('OPERATOR')

    await expect(
      controller.syncFIR('fir-1', 'user-1', { confermaNuovaTrasmissione: true }, req)
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'tenant-sel')
    expect(riapri.execute).not.toHaveBeenCalled()
    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })

  it('da ADMIN: riapre in modo sincrono e poi accoda un job normale, senza flag', async () => {
    ruolo.ruoloEffettivo.mockResolvedValue('ADMIN')

    await controller.syncFIR('fir-1', 'user-1', { confermaNuovaTrasmissione: true }, req)

    expect(ruolo.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'tenant-sel')
    expect(riapri.execute).toHaveBeenCalledWith('fir-1', 'tenant-sel')
    expect(riapri.execute.mock.invocationCallOrder[0]).toBeLessThan(
      queue.addSyncJob.mock.invocationCallOrder[0]
    )
    const arg = queue.addSyncJob.mock.calls[0][0]
    expect(arg).toMatchObject({ firId: 'fir-1', tenantId: 'tenant-sel' })
    // La conferma è già consumata: un retry di BullMQ non deve poter riaprire.
    expect(arg).not.toHaveProperty('confermaNuovaTrasmissione')
  })

  it('riapertura rifiutata dal dominio: 409 con messaggio italiano, nessun job', async () => {
    ruolo.ruoloEffettivo.mockResolvedValue('ADMIN')
    riapri.execute.mockRejectedValue(
      new DomainException('non riapribile', 'RIAPERTURA_RENTRI_NON_CONSENTITA')
    )

    const errore = await controller
      .syncFIR('fir-1', 'user-1', { confermaNuovaTrasmissione: true }, req)
      .catch(e => e)

    expect(errore).toBeInstanceOf(ConflictException)
    expect(errore.message).toBe(
      'Questo FIR non è in uno stato che consente la ritrasmissione dopo la verifica.'
    )
    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })

  it('riapertura su FIR inesistente: 404, nessun job', async () => {
    ruolo.ruoloEffettivo.mockResolvedValue('ADMIN')
    riapri.execute.mockRejectedValue(DomainException.notFound('FIR', 'fir-1'))

    await expect(
      controller.syncFIR('fir-1', 'user-1', { confermaNuovaTrasmissione: true }, req)
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })

  it("senza conferma: nessun controllo di ruolo, nessuna riapertura, job sull'azienda selezionata", async () => {
    await controller.syncFIR('fir-1', 'user-1', {}, req)

    expect(ruolo.ruoloEffettivo).not.toHaveBeenCalled()
    expect(riapri.execute).not.toHaveBeenCalled()
    const arg = queue.addSyncJob.mock.calls[0][0]
    expect(arg.tenantId).toBe('tenant-sel')
    expect(arg).not.toHaveProperty('confermaNuovaTrasmissione')
  })
})
