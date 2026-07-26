import { RentriCertificatoScadenzaJob } from './rentri-certificato-scadenza.job'

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
describe('RentriCertificatoScadenzaJob', () => {
  let job: RentriCertificatoScadenzaJob
  let mockPrisma: any
  let mockMetrics: any
  let mockLogger: any

  beforeEach(() => {
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

    job = new RentriCertificatoScadenzaJob(mockPrisma, mockMetrics, mockLogger)
  })

  it('interroga solo le credenziali dei tenant attivi/in prova (ACTIVE/TRIAL)', async () => {
    mockPrisma.rentriCredential.findMany.mockResolvedValue([])

    await job.eseguiControlloScadenza()

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } },
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
})
