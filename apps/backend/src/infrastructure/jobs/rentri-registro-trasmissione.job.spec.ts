import * as Sentry from '@sentry/node'
import { RentriRegistroTrasmissioneJob } from './rentri-registro-trasmissione.job'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { SOGLIA_STALLO_RENTRI_MS } from '../../application/rentri/sync-fir-to-rentri.use-case'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

describe('RentriRegistroTrasmissioneJob', () => {
  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const esitoNiente = {
    esito: 'NIENTE',
    trasmesse: 0,
    rifiutate: 0,
    nonTrasmissibili: 0,
    inAttesa: 0,
    attesaEsito: 0,
  }

  function build(
    registriPerTenant: Record<string, string[]>,
    senzaCertificato: string[] = [],
    chiamate: string[] = []
  ) {
    const sistema = {
      tenant: {
        findMany: jest.fn().mockResolvedValue(Object.keys(registriPerTenant).map(id => ({ id }))),
      },
    }
    const prisma = {
      registroRifiuti: {
        findMany: jest.fn(({ where }: { where: { tenantId: string } }) =>
          Promise.resolve((registriPerTenant[where.tenantId] ?? []).map(id => ({ id })))
        ),
      },
    }
    const resolver = {
      haCredenziale: jest.fn((t: string) => Promise.resolve(!senzaCertificato.includes(t))),
    }
    const repo = {
      stalliInInvio: jest.fn(() => {
        chiamate.push('stalli')
        return Promise.resolve(0)
      }),
      adottaAutomatiche: jest.fn(() => {
        chiamate.push('automatiche')
        return Promise.resolve(0)
      }),
      adottaCorrezioni: jest.fn(() => {
        chiamate.push('correzioni')
        return Promise.resolve(0)
      }),
    }
    const trasmetti = {
      riprendiAttese: jest.fn(() => {
        chiamate.push('ripresa')
        return Promise.resolve({ riletti: 0, incerte: 0 })
      }),
      trasmettiRegistro: jest.fn((_t: string, r: string) => {
        chiamate.push(`invio:${r}`)
        return Promise.resolve(esitoNiente)
      }),
    }
    const job = new RentriRegistroTrasmissioneJob(
      sistema as any,
      prisma as any,
      resolver as any,
      repo as any,
      trasmetti as any,
      mockLogger as any
    )
    return { job, sistema, prisma, resolver, repo, trasmetti, chiamate }
  }

  afterEach(() => jest.clearAllMocks())

  describe('interruttore di emergenza RENTRI_REGISTRO_INVII_ATTIVI', () => {
    const originale = process.env.RENTRI_REGISTRO_INVII_ATTIVI
    afterEach(() => {
      if (originale === undefined) delete process.env.RENTRI_REGISTRO_INVII_ATTIVI
      else process.env.RENTRI_REGISTRO_INVII_ATTIVI = originale
    })

    it('spento: nessun invio, ripresa degli esiti si, una sola riga di log per giro', async () => {
      process.env.RENTRI_REGISTRO_INVII_ATTIVI = 'false'
      const { job, trasmetti, chiamate } = build({ t1: ['r1', 'r2'], t2: ['r3'] })
      await job.eseguiTrasmissione()
      expect(trasmetti.trasmettiRegistro).not.toHaveBeenCalled()
      expect(chiamate.filter(c => c === 'ripresa')).toHaveLength(2)
      const sospesi = mockLogger.warn.mock.calls.filter(c => /invii RENTRI sospesi/i.test(c[0]))
      expect(sospesi).toHaveLength(1)
      expect(mockLogger.error).not.toHaveBeenCalled()
      expect(Sentry.captureException).not.toHaveBeenCalled()
    })

    it('acceso: nessun log di sospensione', async () => {
      delete process.env.RENTRI_REGISTRO_INVII_ATTIVI
      const { job, trasmetti } = build({ t1: ['r1'] })
      await job.eseguiTrasmissione()
      expect(trasmetti.trasmettiRegistro).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn.mock.calls.filter(c => /sospesi/i.test(c[0]))).toHaveLength(0)
    })
  })

  it('azienda senza certificato saltata senza segnalazione', async () => {
    const { job, repo, trasmetti } = build({ t1: ['r1'], 't-senza': ['r9'] }, ['t-senza'])
    await job.eseguiTrasmissione()
    expect(trasmetti.trasmettiRegistro).toHaveBeenCalledTimes(1)
    expect(trasmetti.trasmettiRegistro).toHaveBeenCalledWith('t1', 'r1')
    expect(repo.stalliInInvio).not.toHaveBeenCalledWith('t-senza', expect.anything())
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('senza certificato'),
      expect.anything()
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('ordine: stalli, ripresa, adozione, invio', async () => {
    const { job, repo, chiamate } = build({ t1: ['r1', 'r2'] })
    await job.eseguiTrasmissione()
    expect(chiamate).toEqual([
      'stalli',
      'ripresa',
      'automatiche',
      'correzioni',
      'invio:r1',
      'invio:r2',
    ])
    const [, prima] = repo.stalliInInvio.mock.calls[0] as unknown as [string, Date]
    const eta = Date.now() - prima.getTime()
    expect(eta).toBeGreaterThanOrEqual(SOGLIA_STALLO_RENTRI_MS - 1000)
    expect(eta).toBeLessThan(SOGLIA_STALLO_RENTRI_MS + 5000)
    expect(repo.adottaAutomatiche).toHaveBeenCalledWith('t1', 1000)
    expect(repo.adottaCorrezioni).toHaveBeenCalledWith('t1', 1000)
  })

  it('errore su un registro: gli altri proseguono (anche di altre aziende)', async () => {
    const { job, trasmetti } = build({ t1: ['r1', 'r2'], t2: ['r3'] })
    trasmetti.trasmettiRegistro.mockImplementation(((_t: string, r: string) =>
      r === 'r1' ? Promise.reject(new Error('boom')) : Promise.resolve(esitoNiente)) as never)
    await expect(job.eseguiTrasmissione()).resolves.toBeUndefined()
    expect(trasmetti.trasmettiRegistro).toHaveBeenCalledTimes(3)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'eseguiTrasmissione', tenantId: 't1', fase: 'invio' },
    })
  })

  it("errore in una fase preliminare di un'azienda: le altre aziende proseguono", async () => {
    const { job, repo, trasmetti } = build({ t1: ['r1'], t2: ['r2'] })
    repo.adottaAutomatiche.mockImplementationOnce((() => Promise.reject(new Error('x'))) as never)
    await job.eseguiTrasmissione()
    expect(trasmetti.trasmettiRegistro).toHaveBeenCalledWith('t2', 'r2')
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it("SENZA_CERTIFICATO dal ciclo: gli altri registri dell'azienda si saltano, nessuna segnalazione", async () => {
    const { job, trasmetti } = build({ t1: ['r1', 'r2'], t2: ['r3'] })
    trasmetti.trasmettiRegistro.mockImplementationOnce((() =>
      Promise.resolve({ ...esitoNiente, esito: 'SENZA_CERTIFICATO' })) as never)
    await job.eseguiTrasmissione()
    expect(trasmetti.trasmettiRegistro).toHaveBeenCalledTimes(2)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it("GIA_IN_CORSO e' normale: nessun errore, nessuna segnalazione", async () => {
    const { job, trasmetti } = build({ t1: ['r1'] })
    trasmetti.trasmettiRegistro.mockResolvedValue({ ...esitoNiente, esito: 'GIA_IN_CORSO' })
    await job.eseguiTrasmissione()
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('giro sovrapposto nello stesso processo: il secondo esce', async () => {
    const { job, sistema } = build({ t1: ['r1'] })
    let sblocca!: () => void
    sistema.tenant.findMany.mockImplementationOnce(
      () => new Promise(r => (sblocca = () => r([{ id: 't1' }]))) as never
    )
    const primo = job.eseguiTrasmissione()
    await job.eseguiTrasmissione()
    expect(sistema.tenant.findMany).toHaveBeenCalledTimes(1)
    sblocca()
    await primo
    // dopo la fine il flag e' libero
    await job.eseguiTrasmissione()
    expect(sistema.tenant.findMany).toHaveBeenCalledTimes(2)
  })

  it('il flag si libera anche se il giro fallisce', async () => {
    const { job, sistema } = build({ t1: ['r1'] })
    sistema.tenant.findMany.mockRejectedValueOnce(new Error('db'))
    await job.eseguiTrasmissione()
    await job.eseguiTrasmissione()
    expect(sistema.tenant.findMany).toHaveBeenCalledTimes(2)
  })

  it('piattaforma esclusa e solo ACTIVE/TRIAL', async () => {
    const { job, sistema } = build({ t1: [] })
    await job.eseguiTrasmissione()
    const where = (sistema.tenant.findMany.mock.calls[0] as any[])[0].where
    expect(JSON.stringify(where)).toContain('ACTIVE')
    expect(JSON.stringify(where)).toContain('TRIAL')
    expect(where).toEqual(escludiPiattaforma({ subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } }))
    expect(where).not.toEqual({ subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } })
  })

  it('solo registri con identificativo RENTRI', async () => {
    const { job, prisma } = build({ t1: ['r1'] })
    await job.eseguiTrasmissione()
    expect((prisma.registroRifiuti.findMany.mock.calls[0] as any[])[0].where).toEqual({
      tenantId: 't1',
      identificativoRentri: { not: null },
    })
  })

  it('i log non contengono dati personali (solo conteggi e id tecnici)', async () => {
    const { job, trasmetti } = build({ t1: ['r1'] })
    trasmetti.trasmettiRegistro.mockResolvedValue({
      ...esitoNiente,
      esito: 'INVIATO',
      trasmesse: 2,
    })
    await job.eseguiTrasmissione()
    const tutto = JSON.stringify([...mockLogger.info.mock.calls, ...mockLogger.warn.mock.calls])
    expect(tutto).not.toMatch(/corpo|codiceFiscale|partitaIva/i)
  })
})
