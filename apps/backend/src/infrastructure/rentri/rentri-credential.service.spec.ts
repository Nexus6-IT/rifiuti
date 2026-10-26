import { BadRequestException } from '@nestjs/common'
import { RentriCredentialService } from './rentri-credential.service'
import { decryptSecret } from './rentri-crypto.util'
import * as Sentry from '@sentry/node'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

/**
 * Verifica che la chiave privata RENTRI sia cifrata a riposo e mai persistita in
 * chiaro, e che getForTenant la restituisca decifrata.
 */
describe('RentriCredentialService', () => {
  let prisma: any
  let service: RentriCredentialService
  const ENC_KEY = 'test-enc-key'
  const config = { credentialEncKey: ENC_KEY } as any

  beforeEach(() => {
    prisma = {
      rentriCredential: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        count: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      fIR: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    }
    service = new RentriCredentialService(prisma, config)
  })

  it('upsert cifra la chiave privata (mai in chiaro nel DB)', async () => {
    await service.upsertForTenant('tenant-1', {
      clientId: 'op-1',
      certificatePem: 'CERT',
      privateKeyPem: 'SUPER-SECRET-KEY',
      algorithm: 'RS256',
      environment: 'demo',
    })

    const args = prisma.rentriCredential.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ tenantId: 'tenant-1' })
    // la chiave salvata è cifrata, non in chiaro
    expect(args.create.privateKeyEnc).not.toContain('SUPER-SECRET-KEY')
    expect(args.create.certificatePem).toBe('CERT')
    // ...e decifrandola si riottiene l'originale
    expect(decryptSecret(args.create.privateKeyEnc, ENC_KEY)).toBe('SUPER-SECRET-KEY')
  })

  it('getForTenant decifra la chiave privata', async () => {
    // simula un record salvato (cifrato) con upsert
    await service.upsertForTenant('tenant-1', {
      clientId: 'op-1',
      certificatePem: 'CERT',
      privateKeyPem: 'KEY-XYZ',
    })
    const stored = prisma.rentriCredential.upsert.mock.calls[0][0].create

    prisma.rentriCredential.findUnique.mockResolvedValue({
      clientId: stored.clientId,
      certificatePem: stored.certificatePem,
      privateKeyEnc: stored.privateKeyEnc,
      algorithm: stored.algorithm,
      environment: stored.environment,
    })

    const cred = await service.getForTenant('tenant-1')
    expect(cred).toMatchObject({
      clientId: 'op-1',
      certificatePem: 'CERT',
      privateKeyPem: 'KEY-XYZ',
      algorithm: 'RS256',
    })
  })

  it('getForTenant ritorna null se non configurato', async () => {
    prisma.rentriCredential.findUnique.mockResolvedValue(null)
    expect(await service.getForTenant('tenant-1')).toBeNull()
  })

  describe('numIscrSito (unità locale RENTRI)', () => {
    const VALID = 'OP1234ABC123456-RM1234'

    it('accetta e salva un numIscrSito nel formato valido', async () => {
      await service.upsertForTenant('tenant-1', {
        clientId: 'op-1',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
        numIscrSito: VALID,
      })

      const args = prisma.rentriCredential.upsert.mock.calls[0][0]
      expect(args.create.numIscrSito).toBe(VALID)
    })

    it('rifiuta un numIscrSito fuori pattern PRIMA di persistere (400 rumoroso in RENTRI altrimenti)', async () => {
      await expect(
        service.upsertForTenant('tenant-1', {
          clientId: 'op-1',
          certificatePem: 'CERT',
          privateKeyPem: 'KEY',
          numIscrSito: 'non-valido',
        })
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(prisma.rentriCredential.upsert).not.toHaveBeenCalled()
    })

    it('permette di non specificare numIscrSito (resta null)', async () => {
      await service.upsertForTenant('tenant-1', {
        clientId: 'op-1',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
      })

      const args = prisma.rentriCredential.upsert.mock.calls[0][0]
      expect(args.create.numIscrSito).toBeNull()
    })

    it('getForTenant restituisce numIscrSito quando presente', async () => {
      await service.upsertForTenant('tenant-1', {
        clientId: 'op-1',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
        numIscrSito: VALID,
      })
      const stored = prisma.rentriCredential.upsert.mock.calls[0][0].create
      prisma.rentriCredential.findUnique.mockResolvedValue(stored)

      const cred = await service.getForTenant('tenant-1')
      expect(cred?.numIscrSito).toBe(VALID)
    })
  })

  describe('numIscrOperatore e cache di sincronizzazione (R4 Task 3)', () => {
    it('salva e restituisce il numIscrOperatore, senza alcun vincolo di formato', async () => {
      await service.upsertForTenant('tenant-1', {
        clientId: 'op-1',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
        numIscrOperatore: 'MI00001234',
      })

      const stored = prisma.rentriCredential.upsert.mock.calls[0][0].create
      expect(stored.numIscrOperatore).toBe('MI00001234')

      prisma.rentriCredential.findUnique.mockResolvedValue(stored)
      const cred = await service.getForTenant('tenant-1')
      expect(cred?.numIscrOperatore).toBe('MI00001234')
    })

    it('permette di non specificare numIscrOperatore (resta null)', async () => {
      await service.upsertForTenant('tenant-1', {
        clientId: 'op-1',
        certificatePem: 'CERT',
        privateKeyPem: 'KEY',
      })

      const args = prisma.rentriCredential.upsert.mock.calls[0][0]
      expect(args.create.numIscrOperatore).toBeNull()
    })

    it('getSitiSincronizzatiAl ritorna null se mai allineato', async () => {
      prisma.rentriCredential.findUnique.mockResolvedValue({ sitiSincronizzatiAl: null })

      expect(await service.getSitiSincronizzatiAl('tenant-1')).toBeNull()
    })

    it('getSitiSincronizzatiAl ritorna null se il tenant non ha credenziale', async () => {
      prisma.rentriCredential.findUnique.mockResolvedValue(null)

      expect(await service.getSitiSincronizzatiAl('tenant-1')).toBeNull()
    })

    it('getSitiSincronizzatiAl restituisce il timestamp salvato', async () => {
      const quando = new Date('2026-07-01T10:00:00Z')
      prisma.rentriCredential.findUnique.mockResolvedValue({ sitiSincronizzatiAl: quando })

      expect(await service.getSitiSincronizzatiAl('tenant-1')).toEqual(quando)
    })

    it('markSitiSincronizzati aggiorna il timestamp a ORA', async () => {
      const prima = Date.now()
      await service.markSitiSincronizzati('tenant-1')
      const dopo = Date.now()

      expect(prisma.rentriCredential.update).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        data: { sitiSincronizzatiAl: expect.any(Date) },
      })
      const valore: Date = prisma.rentriCredential.update.mock.calls[0][0].data.sitiSincronizzatiAl
      expect(valore.getTime()).toBeGreaterThanOrEqual(prima)
      expect(valore.getTime()).toBeLessThanOrEqual(dopo)
    })
  })

  const input = { clientId: 'op-1', certificatePem: 'CERT', privateKeyPem: 'KEY' }

  it('caricamento del certificato riapre i FIR fermi per certificato mancante di quel tenant, non di altri, e ne restituisce gli id', async () => {
    prisma.fIR.findMany.mockResolvedValue([{ id: 'fir-1' }, { id: 'fir-2' }])
    prisma.fIR.updateMany.mockResolvedValue({ count: 2 })

    const riaperti = await service.upsertForTenant('tenant-1', input)

    const filtro = {
      tenantId: 'tenant-1',
      rentriSyncStatus: 'PERMANENTLY_FAILED',
      rentriLastSyncErrorCode: 'RENTRI_CERTIFICATO_MANCANTE',
      status: { not: 'CANCELLED' },
    }
    expect(prisma.fIR.findMany).toHaveBeenCalledWith({ where: filtro, select: { id: true } })
    expect(prisma.fIR.updateMany).toHaveBeenCalledTimes(1)
    const args = prisma.fIR.updateMany.mock.calls[0][0]
    expect(args.where).toEqual({ ...filtro, id: { in: ['fir-1', 'fir-2'] } })
    expect(args.data).toEqual({
      rentriSyncStatus: 'PENDING',
      rentriSyncAttempts: 0,
      rentriLastSyncError: null,
      rentriLastSyncErrorCode: null,
      rentriNextRetryAt: null,
      // il recupero dei PENDING mai avviati richiede avviato_at nullo
      rentriSyncAvviatoAt: null,
    })
    expect(riaperti).toEqual(['fir-1', 'fir-2'])
  })

  it('nessun FIR fermo: nessun updateMany e lista vuota', async () => {
    const riaperti = await service.upsertForTenant('tenant-1', input)

    expect(prisma.fIR.updateMany).not.toHaveBeenCalled()
    expect(riaperti).toEqual([])
  })

  it('riapertura fallita: il certificato resta salvato, errore loggato e segnalato', async () => {
    prisma.fIR.findMany.mockRejectedValue(new Error('db giu'))

    const riaperti = await service.upsertForTenant('tenant-1', input)

    expect(prisma.rentriCredential.upsert).toHaveBeenCalledTimes(1)
    expect(riaperti).toEqual([])
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: expect.objectContaining({ tenantId: 'tenant-1' }) })
    )
  })

  it('upsert non riuscito: nessuna riapertura dei FIR', async () => {
    prisma.rentriCredential.upsert.mockRejectedValue(new Error('db'))

    await expect(service.upsertForTenant('tenant-1', input)).rejects.toThrow('db')

    expect(prisma.fIR.findMany).not.toHaveBeenCalled()
    expect(prisma.fIR.updateMany).not.toHaveBeenCalled()
  })
})
