import * as Sentry from '@sentry/node'
import { RentriRifornimentoScortaJob } from './rentri-rifornimento-scorta.job'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

describe('RentriRifornimentoScortaJob', () => {
  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  function build(unitaLocali: Record<string, unknown[]>, senzaCertificato: string[] = []) {
    const prisma = {
      tenant: {
        findMany: jest.fn().mockResolvedValue(Object.keys(unitaLocali).map(id => ({ id }))),
      },
    }
    const unitaLocaleService = {
      listForTenant: jest.fn((tenantId: string) => Promise.resolve(unitaLocali[tenantId] ?? [])),
    }
    const scortaRepo = { contaTotaleDisponibili: jest.fn() }
    const avviaVidimazione = {
      execute: jest.fn().mockResolvedValue({ richiesti: 0, riusciti: 0, falliti: 0 }),
    }

    const resolver = {
      haCredenziale: jest.fn((tenantId: string) =>
        Promise.resolve(!senzaCertificato.includes(tenantId))
      ),
    }

    const job = new RentriRifornimentoScortaJob(
      prisma as any,
      unitaLocaleService as any,
      scortaRepo as any,
      avviaVidimazione as any,
      mockLogger as any,
      resolver as any
    )
    return { job, scortaRepo, avviaVidimazione, unitaLocaleService, resolver }
  }

  afterEach(() => jest.clearAllMocks())

  it('rifornimento: 3 aziende, una senza certificato → le altre rifornite, info, nessuna segnalazione', async () => {
    const sede = {
      numIscrSito: 'OP1',
      codiceBloccoPredefinito: 'BLK-A',
      dimensioneScortaDesiderata: 10,
    }
    const { job, scortaRepo, avviaVidimazione, unitaLocaleService } = build(
      { t1: [sede], 't-senza': [sede], t3: [sede] },
      ['t-senza']
    )
    scortaRepo.contaTotaleDisponibili.mockResolvedValue(4)

    await job.eseguiRifornimento()

    expect(avviaVidimazione.execute).toHaveBeenCalledTimes(2)
    expect(avviaVidimazione.execute).toHaveBeenCalledWith('t1', 'BLK-A', 6)
    expect(avviaVidimazione.execute).toHaveBeenCalledWith('t3', 'BLK-A', 6)
    expect(unitaLocaleService.listForTenant).not.toHaveBeenCalledWith('t-senza')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'azienda t-senza senza certificato RENTRI: saltata',
      expect.anything()
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('senza soglia configurata non vidima nulla e lo scrive nel log', async () => {
    const { job, avviaVidimazione } = build({
      t1: [
        { numIscrSito: 'OP1', codiceBloccoPredefinito: 'BLK-A', dimensioneScortaDesiderata: null },
      ],
    })

    await job.eseguiRifornimento()

    expect(avviaVidimazione.execute).not.toHaveBeenCalled()
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('soglia'),
      expect.objectContaining({ tenantId: 't1' })
    )
  })

  it('senza blocco predefinito non vidima nulla (fail-closed, mai un blocco indovinato)', async () => {
    const { job, avviaVidimazione } = build({
      t1: [{ numIscrSito: 'OP1', codiceBloccoPredefinito: null, dimensioneScortaDesiderata: 10 }],
    })

    await job.eseguiRifornimento()

    expect(avviaVidimazione.execute).not.toHaveBeenCalled()
  })

  it('sotto soglia: vidima esattamente la differenza', async () => {
    const { job, scortaRepo, avviaVidimazione } = build({
      t1: [
        { numIscrSito: 'OP1', codiceBloccoPredefinito: 'BLK-A', dimensioneScortaDesiderata: 10 },
      ],
    })
    scortaRepo.contaTotaleDisponibili.mockResolvedValue(4)

    await job.eseguiRifornimento()

    expect(avviaVidimazione.execute).toHaveBeenCalledWith('t1', 'BLK-A', 6)
  })

  it('scorta già sopra soglia: nessun rifornimento', async () => {
    const { job, scortaRepo, avviaVidimazione } = build({
      t1: [
        { numIscrSito: 'OP1', codiceBloccoPredefinito: 'BLK-A', dimensioneScortaDesiderata: 10 },
      ],
    })
    scortaRepo.contaTotaleDisponibili.mockResolvedValue(12)

    await job.eseguiRifornimento()

    expect(avviaVidimazione.execute).not.toHaveBeenCalled()
  })

  it('un tenant che fallisce non blocca il rifornimento degli altri', async () => {
    const { job, scortaRepo, avviaVidimazione } = build({
      t1: [{ numIscrSito: 'OP1', codiceBloccoPredefinito: 'BLK-A', dimensioneScortaDesiderata: 5 }],
      t2: [{ numIscrSito: 'OP2', codiceBloccoPredefinito: 'BLK-B', dimensioneScortaDesiderata: 5 }],
    })
    scortaRepo.contaTotaleDisponibili.mockResolvedValue(0)
    avviaVidimazione.execute
      .mockRejectedValueOnce(new Error('RENTRI non raggiungibile'))
      .mockResolvedValueOnce({ richiesti: 5, riusciti: 5, falliti: 0 })

    await job.eseguiRifornimento()

    expect(avviaVidimazione.execute).toHaveBeenCalledTimes(2)
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('un tenant che fallisce in listForTenant non ferma i successivi e viene segnalato con tenantId', async () => {
    const { job, scortaRepo, avviaVidimazione, unitaLocaleService } = build({ t1: [], t2: [] })
    unitaLocaleService.listForTenant.mockImplementation((tenantId: string) =>
      tenantId === 't1'
        ? Promise.reject(new Error('credenziale scaduta'))
        : Promise.resolve([
            { numIscrSito: 'OP2', codiceBloccoPredefinito: 'BLK-B', dimensioneScortaDesiderata: 5 },
          ])
    )
    scortaRepo.contaTotaleDisponibili.mockResolvedValue(0)

    await expect(job.eseguiRifornimento()).resolves.toBeUndefined()

    expect(avviaVidimazione.execute).toHaveBeenCalledTimes(1)
    expect(avviaVidimazione.execute).toHaveBeenCalledWith('t2', 'BLK-B', 5)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'eseguiRifornimento', tenantId: 't1' },
    })
  })
})
