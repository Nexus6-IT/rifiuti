import * as Sentry from '@sentry/node'
import { RentriRiconciliazioneJob } from './rentri-riconciliazione.job'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

/** Moduli: tutte le aziende hanno `rentri`, salvo quelle elencate in `senza`. */
function moduliMock(senza: string[] = []) {
  return {
    tenantConModulo: jest.fn(
      async (ids: readonly string[], _modulo: string) =>
        new Set(ids.filter(id => !senza.includes(id)))
    ),
  }
}

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
  let mockResolver: any
  let mockModuli: ReturnType<typeof moduliMock>

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

    mockResolver = { haCredenziale: jest.fn().mockResolvedValue(true) }

    mockModuli = moduliMock()
    job = new RentriRiconciliazioneJob(
      mockPrisma,
      mockRiconciliaStatoRentri,
      mockLogger,
      mockResolver,
      mockModuli as any
    )
  })

  it('riconciliazione: 3 aziende, una senza certificato → le altre riconciliate, info, nessuna segnalazione', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't-senza' }, { id: 't3' }])
    mockResolver.haCredenziale.mockImplementation(async (id: string) => id !== 't-senza')
    mockRiconciliaStatoRentri.execute.mockResolvedValue({
      controllati: 1,
      corretti: 0,
      segnalati: 0,
      nessunaDivergenza: 1,
    })

    const esito = await job.riconcilia()

    expect(mockRiconciliaStatoRentri.execute).toHaveBeenCalledTimes(2)
    expect(mockRiconciliaStatoRentri.execute).not.toHaveBeenCalledWith('t-senza')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'azienda t-senza senza certificato RENTRI: saltata',
      expect.anything()
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(esito.tenantConErrore).toBe(0)
  })

  it('interroga solo i tenant attivi/in prova (ACTIVE/TRIAL), piattaforma esclusa', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([])

    await job.eseguiRiconciliazione()

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: escludiPiattaforma({ subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } }),
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

  // Guardia di regressione: verde anche prima della modifica (il comportamento esiste già).
  it('eseguiRiconciliazione non rilancia e segnala una volta', async () => {
    mockPrisma.tenant.findMany.mockRejectedValue(new Error('db giù'))

    await expect(job.eseguiRiconciliazione()).resolves.toBeUndefined()

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('riconcilia rilancia se la lettura dei tenant fallisce', async () => {
    mockPrisma.tenant.findMany.mockRejectedValue(new Error('db giù'))

    await expect(job.riconcilia()).rejects.toThrow('db giù')
    // La segnalazione a Bugsink spetta solo all'handler @Cron, non al giro.
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('riconcilia restituisce i tenant con errore', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    mockRiconciliaStatoRentri.execute.mockImplementation((tenantId: string) =>
      tenantId === 't2'
        ? Promise.reject(new Error('credenziale scaduta'))
        : Promise.resolve({ controllati: 0, corretti: 0, segnalati: 0, nessunaDivergenza: 0 })
    )

    await expect(job.riconcilia()).resolves.toEqual({ tenantTotali: 2, tenantConErrore: 1 })
  })

  it('moduli: solo le aziende col modulo rentri, con UNA query sui moduli', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't-no' }, { id: 't3' }])
    mockModuli.tenantConModulo.mockResolvedValue(new Set(['t1', 't3']))
    mockRiconciliaStatoRentri.execute.mockResolvedValue({ controllati: 0 })

    await job.riconcilia()

    expect(mockModuli.tenantConModulo).toHaveBeenCalledTimes(1)
    expect(mockModuli.tenantConModulo).toHaveBeenCalledWith(['t1', 't-no', 't3'], 'rentri')
    expect(mockResolver.haCredenziale).not.toHaveBeenCalledWith('t-no')
    expect(mockRiconciliaStatoRentri.execute).toHaveBeenCalledTimes(2)
    expect(mockRiconciliaStatoRentri.execute).not.toHaveBeenCalledWith('t-no')
  })

  it('moduli: nessuna azienda col modulo, il giro termina senza errori', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    mockModuli.tenantConModulo.mockResolvedValue(new Set())

    const esito = await job.riconcilia()

    expect(mockRiconciliaStatoRentri.execute).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(esito.tenantConErrore).toBe(0)
  })
})
