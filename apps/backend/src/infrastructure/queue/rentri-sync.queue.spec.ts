import { RENTRISyncQueue } from './rentri-sync.queue'

/**
 * `addSyncJob` deduplica per FIR: il jobId è `sync-<firId>` e un job ancora
 * vivo per lo stesso FIR non viene riaccodato. La `Queue` di BullMQ è un
 * mock iniettato al posto di quella creata in `onModuleInit`.
 */
describe('RENTRISyncQueue.addSyncJob', () => {
  let queue: RENTRISyncQueue
  let mockBull: { add: jest.Mock; getJob: jest.Mock }

  beforeEach(() => {
    const logger: any = { setContext: jest.fn(), info: jest.fn() }
    queue = new RENTRISyncQueue({ get: jest.fn() } as any, logger)
    mockBull = {
      add: jest.fn().mockResolvedValue({ id: 'sync-fir-1' }),
      getJob: jest.fn().mockResolvedValue(undefined),
    }
    ;(queue as any).queue = mockBull
  })

  it('jobId è sync-<firId>', async () => {
    const id = await queue.addSyncJob({ firId: 'fir-1', tenantId: 't-1' })

    expect(mockBull.getJob).toHaveBeenCalledWith('sync-fir-1')
    expect(mockBull.add).toHaveBeenCalledWith(
      'sync-fir',
      expect.objectContaining({ firId: 'fir-1', tenantId: 't-1' }),
      expect.objectContaining({ jobId: 'sync-fir-1' })
    )
    expect(id).toBe('sync-fir-1')
  })

  it.each(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'])(
    'stesso FIR due volte con job %s: un solo add, stesso id',
    async (stato) => {
      mockBull.getJob.mockResolvedValue({
        id: 'sync-fir-1',
        getState: jest.fn().mockResolvedValue(stato),
        remove: jest.fn(),
      })

      const id = await queue.addSyncJob({ firId: 'fir-1', tenantId: 't-1' })

      expect(id).toBe('sync-fir-1')
      expect(mockBull.add).not.toHaveBeenCalled()
    }
  )

  it.each(['completed', 'failed'])('job precedente %s: remove e nuovo add', async (stato) => {
    const remove = jest.fn().mockResolvedValue(undefined)
    mockBull.getJob.mockResolvedValue({
      id: 'sync-fir-1',
      getState: jest.fn().mockResolvedValue(stato),
      remove,
    })

    await queue.addSyncJob({ firId: 'fir-1', tenantId: 't-1' })

    expect(remove).toHaveBeenCalledTimes(1)
    expect(mockBull.add).toHaveBeenCalledTimes(1)
  })

  it('stato unknown: trattato come assente, nuovo add senza remove', async () => {
    const remove = jest.fn()
    mockBull.getJob.mockResolvedValue({
      id: 'sync-fir-1',
      getState: jest.fn().mockResolvedValue('unknown'),
      remove,
    })

    await queue.addSyncJob({ firId: 'fir-1', tenantId: 't-1' })

    expect(remove).not.toHaveBeenCalled()
    expect(mockBull.add).toHaveBeenCalledTimes(1)
  })

  it('confermaNuovaTrasmissione passa nel data del job', async () => {
    await queue.addSyncJob({ firId: 'fir-1', tenantId: 't-1', confermaNuovaTrasmissione: true })

    expect(mockBull.add).toHaveBeenCalledWith(
      'sync-fir',
      expect.objectContaining({ confermaNuovaTrasmissione: true }),
      expect.anything()
    )
  })
})
