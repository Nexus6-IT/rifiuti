import { RentriTrasmissioniSospeseJob } from './rentri-trasmissioni-sospese.job'
import { SOGLIA_STALLO_RENTRI_MS } from '../../application/rentri/sync-fir-to-rentri.use-case'

describe('RentriTrasmissioniSospeseJob', () => {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  let firRepo: { elencaTrasmissioniRentriSospese: jest.Mock }
  let queue: { addSyncJob: jest.Mock }
  let job: RentriTrasmissioniSospeseJob

  beforeEach(() => {
    jest.clearAllMocks()
    firRepo = { elencaTrasmissioniRentriSospese: jest.fn() }
    queue = { addSyncJob: jest.fn().mockResolvedValue('id') }
    job = new RentriTrasmissioniSospeseJob(firRepo as any, queue as any, logger)
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
    expect(queue.addSyncJob).toHaveBeenCalledWith({ firId: 'f1', tenantId: 't1', priority: 'low' })
    expect(queue.addSyncJob).toHaveBeenCalledWith({ firId: 'f2', tenantId: 't2', priority: 'low' })
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
