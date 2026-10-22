import * as Sentry from '@sentry/node'
import { RentriRiconciliazioneJob } from './rentri-riconciliazione.job'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

/**
 * Test unitari di RentriRiconciliazioneJob (R5 Task 4).
 *
 * Copre l'isolamento per tenant richiesto dal piano: un tenant con errore
 * (es. credenziale scaduta) non deve impedire la riconciliazione degli
 * altri tenant nello stesso giro.
 */
describe('RentriRiconciliazioneJob', () => {
  let job: RentriRiconciliazioneJob
  let mockPrisma: any
  let mockRiconciliaStatoRentri: any
  let mockLogger: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = {
      tenant: { findMany: jest.fn() },
    }
    mockRiconciliaStatoRentri = { execute: jest.fn() }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }

    job = new RentriRiconciliazioneJob(mockPrisma, mockRiconciliaStatoRentri, mockLogger)
  })

  it('interroga solo i tenant attivi/in prova (ACTIVE/TRIAL)', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([])

    await job.eseguiRiconciliazione()

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } },
      })
    )
  })

  it('isola un tenant che fallisce: gli altri vengono comunque riconciliati', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-guasto' },
      { id: 'tenant-sano-1' },
      { id: 'tenant-sano-2' },
    ])

    mockRiconciliaStatoRentri.execute.mockImplementation((tenantId: string) => {
      if (tenantId === 'tenant-guasto') {
        return Promise.reject(new Error('credenziale RENTRI scaduta'))
      }
      return Promise.resolve({
        tenantId,
        controllati: 1,
        corretti: 0,
        segnalati: 0,
        nessunaDivergenza: 1,
        dettagli: [],
      })
    })

    await job.eseguiRiconciliazione()

    expect(mockRiconciliaStatoRentri.execute).toHaveBeenCalledTimes(3)
    expect(mockRiconciliaStatoRentri.execute).toHaveBeenCalledWith('tenant-guasto')
    expect(mockRiconciliaStatoRentri.execute).toHaveBeenCalledWith('tenant-sano-1')
    expect(mockRiconciliaStatoRentri.execute).toHaveBeenCalledWith('tenant-sano-2')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('fallita'),
      expect.any(Error),
      expect.objectContaining({ tenantId: 'tenant-guasto' })
    )
  })

  it('non lancia mai (il chiamante/scheduler non deve mai vedere un job in errore)', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }])
    mockRiconciliaStatoRentri.execute.mockRejectedValue(new Error('boom'))

    await expect(job.eseguiRiconciliazione()).resolves.toBeUndefined()
  })

  it('un errore di un solo tenant della riconciliazione arriva a Bugsink con il tenant', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    mockRiconciliaStatoRentri.execute.mockImplementation((tenantId: string) =>
      tenantId === 't2'
        ? Promise.reject(new Error('credenziale scaduta'))
        : Promise.resolve({ controllati: 0, corretti: 0, segnalati: 0, nessunaDivergenza: 0 })
    )

    await expect(job.eseguiRiconciliazione()).resolves.toBeUndefined()

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'eseguiRiconciliazione', tenantId: 't2' },
    })
  })
})
