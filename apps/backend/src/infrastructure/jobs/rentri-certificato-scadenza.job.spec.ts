import * as Sentry from '@sentry/node'
import { RentriCertificatoScadenzaJob } from './rentri-certificato-scadenza.job'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

// Stesso pattern di `get-rentri-diagnostica.use-case.spec.ts`: generare un
// vero certificato X.509 firmato richiederebbe OpenSSL o una libreria
// esterna non disponibile in questo ambiente Jest — si mocka direttamente
// `X509Certificate` (il codice lo invoca solo per leggere `.validTo`),
// pilotando la sola data che il job usa.
jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto')
  return {
    ...actual,
    X509Certificate: jest.fn(),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { X509Certificate } = require('node:crypto')

/**
 * Test unitari di RentriCertificatoScadenzaJob (R5 Task 5).
 *
 * Copre: il gauge `rentriCertificateExpiryDays` impostato con un valore
 * coerente con una data di scadenza nota, l'isolamento per tenant (un
 * certificato non analizzabile o un errore inatteso non deve impedire
 * l'aggiornamento del gauge per gli altri tenant) e il filtro sui soli
 * tenant ACTIVE/TRIAL.
 */
/** Moduli: tutte le aziende hanno `rentri`, salvo quelle elencate in `senza`. */
function moduliMock(senza: string[] = []) {
  return {
    tenantConModulo: jest.fn(
      async (ids: readonly string[], _modulo: string) =>
        new Set(ids.filter(id => !senza.includes(id)))
    ),
  }
}

describe('RentriCertificatoScadenzaJob', () => {
  let job: RentriCertificatoScadenzaJob
  let mockPrisma: any
  let mockMetrics: any
  let mockLogger: any
  let mockModuli: ReturnType<typeof moduliMock>

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-sano' }]),
      },
      rentriCredential: { findMany: jest.fn() },
    }
    mockMetrics = {
      rentriCertificateExpiryDays: { set: jest.fn() },
    }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    ;(X509Certificate as jest.Mock).mockReset()

    mockModuli = moduliMock()
    job = new RentriCertificatoScadenzaJob(mockPrisma, mockMetrics, mockLogger, mockModuli as any)
  })

  it('interroga solo le credenziali dei tenant attivi/in prova (ACTIVE/TRIAL), piattaforma esclusa', async () => {
    mockPrisma.rentriCredential.findMany.mockResolvedValue([])

    await job.eseguiControlloScadenza()

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: escludiPiattaforma({ subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } }),
      })
    )
    expect(mockPrisma.rentriCredential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: { in: ['tenant-1', 'tenant-sano'] } },
      })
    )
  })

  it('imposta il gauge coerente con una data di scadenza nota (30 giorni)', async () => {
    const validTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)
    ;(X509Certificate as jest.Mock).mockImplementation(() => ({
      validTo: validTo.toUTCString(),
    }))

    mockPrisma.rentriCredential.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', certificatePem: 'PEM-FINTO' },
    ])

    await job.eseguiControlloScadenza()

    expect(mockMetrics.rentriCertificateExpiryDays.set).toHaveBeenCalledWith(
      { tenant_id: 'tenant-1' },
      30
    )
  })

  it('isola un tenant con certificato non analizzabile: gli altri vengono comunque aggiornati', async () => {
    mockPrisma.rentriCredential.findMany.mockResolvedValue([
      { tenantId: 'tenant-rotto', certificatePem: 'PEM-NON-VALIDO' },
      { tenantId: 'tenant-sano', certificatePem: 'PEM-VALIDO' },
    ])

    const validTo = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)
    ;(X509Certificate as jest.Mock).mockImplementation((pem: string) => {
      if (pem === 'PEM-NON-VALIDO') {
        throw new Error('certificato non analizzabile')
      }
      return { validTo: validTo.toUTCString() }
    })

    await job.eseguiControlloScadenza()

    expect(mockMetrics.rentriCertificateExpiryDays.set).toHaveBeenCalledTimes(1)
    expect(mockMetrics.rentriCertificateExpiryDays.set).toHaveBeenCalledWith(
      { tenant_id: 'tenant-sano' },
      10
    )
  })

  it('non lancia mai (il chiamante/scheduler non deve mai vedere un job in errore)', async () => {
    mockPrisma.rentriCredential.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', certificatePem: 'PEM' },
    ])
    ;(X509Certificate as jest.Mock).mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(job.eseguiControlloScadenza()).resolves.toBeUndefined()
  })

  // Guardia di regressione: verde anche prima della modifica (il comportamento esiste già).
  it('eseguiControlloScadenza non rilancia e segnala una volta', async () => {
    mockPrisma.tenant.findMany.mockRejectedValue(new Error('db giù'))

    await expect(job.eseguiControlloScadenza()).resolves.toBeUndefined()

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('controllaScadenze rilancia se la lettura dei tenant fallisce', async () => {
    mockPrisma.tenant.findMany.mockRejectedValue(new Error('db giù'))

    await expect(job.controllaScadenze()).rejects.toThrow('db giù')
    // La segnalazione a Bugsink spetta solo all'handler @Cron, non al giro.
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('controllaScadenze restituisce i tenant con errore', async () => {
    mockPrisma.rentriCredential.findMany.mockResolvedValue([
      { tenantId: 'tenant-rotto', certificatePem: 'PEM-NON-VALIDO' },
      { tenantId: 'tenant-sano', certificatePem: 'PEM-VALIDO' },
    ])
    const validTo = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)
    ;(X509Certificate as jest.Mock).mockImplementation(() => ({ validTo: validTo.toUTCString() }))
    // Un errore inatteso su un solo tenant (qui: la scrittura del gauge) conta come errore.
    mockMetrics.rentriCertificateExpiryDays.set.mockImplementation(
      (labels: { tenant_id: string }) => {
        if (labels.tenant_id === 'tenant-rotto') throw new Error('gauge non scrivibile')
      }
    )

    await expect(job.controllaScadenze()).resolves.toEqual({ tenantTotali: 2, tenantConErrore: 1 })
  })

  it('un certificato non analizzabile conta come errore del tenant: il gauge resta vecchio', async () => {
    mockPrisma.rentriCredential.findMany.mockResolvedValue([
      { tenantId: 'tenant-rotto', certificatePem: 'PEM-NON-VALIDO' },
      { tenantId: 'tenant-sano', certificatePem: 'PEM-VALIDO' },
    ])
    const validTo = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000)
    ;(X509Certificate as jest.Mock).mockImplementation((pem: string) => {
      if (pem === 'PEM-NON-VALIDO') throw new Error('certificato non analizzabile')
      return { validTo: validTo.toUTCString() }
    })

    await expect(job.controllaScadenze()).resolves.toEqual({ tenantTotali: 2, tenantConErrore: 1 })
    expect(mockMetrics.rentriCertificateExpiryDays.set).toHaveBeenCalledTimes(1)
  })

  it('moduli: legge le credenziali delle sole aziende col modulo rentri, UNA query sui moduli', async () => {
    mockModuli.tenantConModulo.mockResolvedValue(new Set(['tenant-sano']))
    mockPrisma.rentriCredential.findMany.mockResolvedValue([])

    await job.eseguiControlloScadenza()

    expect(mockModuli.tenantConModulo).toHaveBeenCalledTimes(1)
    expect(mockModuli.tenantConModulo).toHaveBeenCalledWith(['tenant-1', 'tenant-sano'], 'rentri')
    expect(mockPrisma.rentriCredential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['tenant-sano'] } } })
    )
  })

  it('moduli: nessuna azienda col modulo, il giro termina senza errori e senza leggere credenziali', async () => {
    mockModuli.tenantConModulo.mockResolvedValue(new Set())
    mockPrisma.rentriCredential.findMany.mockResolvedValue([])

    const esito = await job.controllaScadenze()

    expect(mockMetrics.rentriCertificateExpiryDays.set).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(esito.tenantConErrore).toBe(0)
  })
})
