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
})
