import { Job, UnrecoverableError } from 'bullmq'
import { RENTRISyncJobProcessor } from './rentri-sync.job'
import { TenantContext } from '../../../core/context/tenant-context'

/**
 * Il worker deve lavorare nel contesto dell'azienda del job (RLS pezzo 2c):
 * `TenantContext` reale, il contesto viene catturato dentro lo use case simulato.
 */
describe('RENTRISyncJobProcessor - contesto azienda', () => {
  let processor: RENTRISyncJobProcessor
  let syncUseCase: { execute: jest.Mock }
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
  const metrics = { firSyncDuration: { observe: jest.fn() } }

  const creaJob = (data: Record<string, unknown>) =>
    ({
      id: 'job-1',
      data,
      attemptsMade: 0,
      updateProgress: jest.fn(),
    }) as unknown as Job

  beforeEach(() => {
    delete process.env.CURRENT_TENANT_ID
    syncUseCase = { execute: jest.fn() }
    processor = new RENTRISyncJobProcessor(
      { get: jest.fn() } as any,
      logger as any,
      metrics as any,
      syncUseCase as any,
      {} as any
    )
  })

  it("rentri-sync: il lavoro del job gira nel contesto dell'azienda del job", async () => {
    let visto: string | null = 'non-chiamato'
    syncUseCase.execute.mockImplementation(async () => {
      await Promise.resolve()
      visto = TenantContext.getStoreTenantId()
      return { success: true }
    })

    await processor['processJob'](creaJob({ type: 'single', firId: 'f1', tenantId: 'azienda-A' }))

    expect(visto).toBe('azienda-A')
  })

  it('rentri-sync: due job di aziende diverse in parallelo vedono ciascuno la propria azienda', async () => {
    const visti: Record<string, string | null> = {}
    syncUseCase.execute.mockImplementation(async (firId: string) => {
      await new Promise(r => setTimeout(r, firId === 'f1' ? 20 : 1))
      visti[firId] = TenantContext.getStoreTenantId()
      return { success: true }
    })

    await Promise.all([
      processor['processJob'](creaJob({ type: 'single', firId: 'f1', tenantId: 'azienda-A' })),
      processor['processJob'](creaJob({ type: 'single', firId: 'f2', tenantId: 'azienda-B' })),
    ])

    expect(visti).toEqual({ f1: 'azienda-A', f2: 'azienda-B' })
  })

  it.each([undefined, '', null])(
    'rentri-sync: job senza tenantId (%p) fallisce in modo definitivo e non tocca il database',
    async tenantId => {
      await expect(
        processor['processJob'](creaJob({ type: 'single', firId: 'f1', tenantId }))
      ).rejects.toBeInstanceOf(UnrecoverableError)

      expect(syncUseCase.execute).not.toHaveBeenCalled()
    }
  )

  it("rentri-sync batch: ogni FIR del batch nel contesto dell'azienda", async () => {
    const visti: Array<[string, string | null]> = []
    syncUseCase.execute.mockImplementation(async (firId: string) => {
      await Promise.resolve()
      visti.push([firId, TenantContext.getStoreTenantId()])
      return { success: true }
    })

    await processor['processJob'](
      creaJob({ type: 'batch', firIds: ['f1', 'f2', 'f3'], tenantId: 'azienda-C' })
    )

    expect(visti).toEqual([
      ['f1', 'azienda-C'],
      ['f2', 'azienda-C'],
      ['f3', 'azienda-C'],
    ])
  })
})
