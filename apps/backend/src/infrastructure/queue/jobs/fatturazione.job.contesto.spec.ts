import { Job, UnrecoverableError } from 'bullmq'
import { TenantContext } from '../../../core/context/tenant-context'
import { FatturazioneJobProcessor } from './fatturazione.job'

const mockEsegui = jest.fn()
jest.mock('../../../application/fatturazione/anteprima', () => ({
  ...jest.requireActual('../../../application/fatturazione/anteprima'),
  eseguiAnteprima: (...a: unknown[]) => mockEsegui(...a),
  segnaFallita: jest.fn(),
}))

/**
 * Il worker deve lavorare nel contesto dell'azienda del job (RLS pezzo 2c): `TenantContext`
 * reale, il contesto viene catturato dentro `eseguiAnteprima` simulato.
 */
describe('FatturazioneJobProcessor - contesto azienda', () => {
  const creaJob = (data: Record<string, unknown>) =>
    ({ id: 'j', data, attemptsMade: 0, opts: { attempts: 2 } }) as unknown as Job<never>
  let prisma: { $queryRaw: jest.Mock; $transaction: jest.Mock; $executeRaw: jest.Mock }
  let processor: FatturazioneJobProcessor

  beforeEach(() => {
    delete process.env.CURRENT_TENANT_ID
    mockEsegui.mockReset()
    prisma = { $queryRaw: jest.fn(), $transaction: jest.fn(), $executeRaw: jest.fn() }
    processor = new FatturazioneJobProcessor(prisma as never)
  })

  it('il lavoro del job gira nel contesto dell’azienda del job', async () => {
    let visto: string | null = 'non-chiamato'
    mockEsegui.mockImplementation(async () => {
      await Promise.resolve()
      visto = TenantContext.getStoreTenantId()
    })
    await processor.process(
      creaJob({
        tenantId: 'azienda-A',
        elaborazioneId: '00000000-0000-4000-8000-000000000003',
        tipo: 'anteprima',
        versione: 1,
      })
    )
    expect(visto).toBe('azienda-A')
  })

  it('il tenantId con spazi arriva normalizzato', async () => {
    let visto: string | null = 'non-chiamato'
    mockEsegui.mockImplementation(async (_p: unknown, tenantId: string) => {
      visto = `${TenantContext.getStoreTenantId()}|${tenantId}`
    })
    await processor.process(
      creaJob({
        tenantId: ' azienda-A ',
        elaborazioneId: '00000000-0000-4000-8000-000000000003',
        tipo: 'anteprima',
        versione: 1,
      })
    )
    expect(visto).toBe('azienda-A|azienda-A')
  })

  it('due job di aziende diverse in parallelo vedono ciascuno la propria azienda', async () => {
    const visti: Record<string, string | null> = {}
    mockEsegui.mockImplementation(async (_p: unknown, _t: string, elaborazioneId: string) => {
      await new Promise(r =>
        setTimeout(r, elaborazioneId === '00000000-0000-4000-8000-000000000001' ? 20 : 1)
      )
      visti[elaborazioneId] = TenantContext.getStoreTenantId()
    })
    await Promise.all([
      processor.process(
        creaJob({
          tenantId: 'azienda-A',
          elaborazioneId: '00000000-0000-4000-8000-000000000001',
          tipo: 'anteprima',
          versione: 1,
        })
      ),
      processor.process(
        creaJob({
          tenantId: 'azienda-B',
          elaborazioneId: '00000000-0000-4000-8000-000000000002',
          tipo: 'anteprima',
          versione: 1,
        })
      ),
    ])
    expect(visti).toEqual({
      '00000000-0000-4000-8000-000000000001': 'azienda-A',
      '00000000-0000-4000-8000-000000000002': 'azienda-B',
    })
  })

  it.each([undefined, '', '   ', null])(
    'job senza tenantId (%p): UnrecoverableError, nessuna query',
    async tenantId => {
      await expect(
        processor.process(
          creaJob({
            tenantId,
            elaborazioneId: '00000000-0000-4000-8000-000000000003',
            tipo: 'anteprima',
            versione: 1,
          })
        )
      ).rejects.toBeInstanceOf(UnrecoverableError)
      expect(mockEsegui).not.toHaveBeenCalled()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    }
  )
})
