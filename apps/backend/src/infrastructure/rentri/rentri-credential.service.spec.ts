import { BadRequestException } from '@nestjs/common'
import { RentriCredentialService } from './rentri-credential.service'
import { decryptSecret } from './rentri-crypto.util'

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
})
