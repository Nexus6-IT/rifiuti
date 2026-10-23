import { RentriTrasmissioniSospeseJob } from './rentri-trasmissioni-sospese.job'
import { SOGLIA_STALLO_RENTRI_MS } from '../../application/rentri/sync-fir-to-rentri.use-case'

describe('RentriTrasmissioniSospeseJob', () => {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  let firRepo: { elencaTrasmissioniRentriSospese: jest.Mock }
  let queue: { addSyncJob: jest.Mock }
  let modalita: { getForTenant: jest.Mock }
  let resolver: { haCredenziale: jest.Mock }
  let job: RentriTrasmissioniSospeseJob

  beforeEach(() => {
    jest.clearAllMocks()
    firRepo = { elencaTrasmissioniRentriSospese: jest.fn() }
    queue = { addSyncJob: jest.fn().mockResolvedValue('id') }
    modalita = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }),
    }
    resolver = { haCredenziale: jest.fn().mockResolvedValue(true) }
    job = new RentriTrasmissioniSospeseJob(
      firRepo as any,
      queue as any,
      logger,
      modalita as any,
      resolver as any
    )
  })

  it('trasmissioni sospese: FIR di azienda senza certificato non accodato', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f-senza', tenantId: 't-senza' },
    ])
    resolver.haCredenziale.mockImplementation(async (id: string) => id !== 't-senza')

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(1)
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f1' }))
    expect(logger.info).toHaveBeenCalledWith(
      'azienda t-senza senza certificato RENTRI: saltata',
      expect.anything()
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('accoda i FIR sospesi con priorità low', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f2', tenantId: 't2' },
    ])
    const prima = Date.now()

    await job.riprendi()

    const [soglia, limite] = firRepo.elencaTrasmissioniRentriSospese.mock.calls[0]
    expect(limite).toBe(100)
    expect(Math.abs(soglia.getTime() - (prima - SOGLIA_STALLO_RENTRI_MS))).toBeLessThan(5000)
    expect(queue.addSyncJob).toHaveBeenCalledWith({
      firId: 'f1',
      tenantId: 't1',
      priority: 'low',
      richiedeConferma: false,
    })
    expect(queue.addSyncJob).toHaveBeenCalledWith({
      firId: 'f2',
      tenantId: 't2',
      priority: 'low',
      richiedeConferma: false,
    })
  })

  it('tenant IBRIDA: la ripresa chiede la conferma del legame, AUTOMATICA no', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f-ibrida', tenantId: 't-ibrida' },
      { firId: 'f-auto', tenantId: 't-auto' },
      { firId: 'f-ibrida-2', tenantId: 't-ibrida' },
    ])
    modalita.getForTenant.mockImplementation(async (tenantId: string) => ({
      modalitaLegame: tenantId === 't-ibrida' ? 'IBRIDA' : 'AUTOMATICA',
      certificatoConfigurato: true,
    }))

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ firId: 'f-ibrida', richiedeConferma: true })
    )
    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ firId: 'f-ibrida-2', richiedeConferma: true })
    )
    expect(queue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ firId: 'f-auto', richiedeConferma: false })
    )
    // Una lettura della modalità per tenant, non per FIR.
    expect(modalita.getForTenant).toHaveBeenCalledTimes(2)
  })

  it('modalità non leggibile: quel FIR non si accoda, gli altri sì', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f2', tenantId: 't2' },
    ])
    modalita.getForTenant.mockImplementation(async (tenantId: string) => {
      if (tenantId === 't1') throw new Error('db')
      return { modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }
    })

    await job.riprendi()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(1)
    expect(queue.addSyncJob).toHaveBeenCalledWith(expect.objectContaining({ firId: 'f2' }))
    expect(logger.error).toHaveBeenCalled()
  })

  it('un errore di accodamento su un FIR non ferma gli altri', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockResolvedValue([
      { firId: 'f1', tenantId: 't1' },
      { firId: 'f2', tenantId: 't2' },
    ])
    queue.addSyncJob.mockRejectedValueOnce(new Error('redis giù')).mockResolvedValueOnce('id')

    await expect(job.riprendi()).resolves.toBeUndefined()

    expect(queue.addSyncJob).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalled()
  })

  it('un errore nell’elenco non lancia', async () => {
    firRepo.elencaTrasmissioniRentriSospese.mockRejectedValue(new Error('db'))

    await expect(job.riprendi()).resolves.toBeUndefined()
    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })
})
