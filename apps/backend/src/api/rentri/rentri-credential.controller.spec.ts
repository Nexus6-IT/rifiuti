import { BadRequestException } from '@nestjs/common'
import * as forge from 'node-forge'
import { RentriCredentialController } from './rentri-credential.controller'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { SetRentriCredentialDto } from './dto/set-rentri-credential.dto'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'admin',
  permissions: [],
}

/** Genera un PKCS#12 base64 di test (keypair RSA + cert self-signed). */
function makePkcs12(passphrase: string): string {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
  const attrs = [{ name: 'commonName', value: 'rentri-test' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' })
  return forge.util.encode64(forge.asn1.toDer(asn1).getBytes())
}

describe('RentriCredentialController', () => {
  let controller: RentriCredentialController
  let service: jest.Mocked<RentriCredentialService>

  beforeEach(() => {
    service = {
      upsertForTenant: jest.fn().mockResolvedValue(undefined),
      getForTenant: jest.fn(),
      hasForTenant: jest.fn(),
      removeForTenant: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RentriCredentialService>

    controller = new RentriCredentialController(service)
  })

  describe('PUT (set)', () => {
    it('salva la credenziale da PEM diretto', async () => {
      const dto: SetRentriCredentialDto = {
        clientId: 'client-1',
        certificatePem: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----\nxyz\n-----END RSA PRIVATE KEY-----',
        algorithm: 'RS256',
        environment: 'demo',
      }

      const res = await controller.set(dto, user)

      expect(res).toEqual({ success: true })
      expect(service.upsertForTenant).toHaveBeenCalledWith('tenant-1', {
        clientId: 'client-1',
        certificatePem: dto.certificatePem,
        privateKeyPem: dto.privateKeyPem,
        algorithm: 'RS256',
        environment: 'demo',
      })
    })

    it('salva la credenziale da PKCS#12 (convertito in PEM)', async () => {
      const passphrase = 'pw-123'
      const dto: SetRentriCredentialDto = {
        clientId: 'client-2',
        pkcs12Base64: makePkcs12(passphrase),
        pkcs12Passphrase: passphrase,
      }

      const res = await controller.set(dto, user)

      expect(res).toEqual({ success: true })
      expect(service.upsertForTenant).toHaveBeenCalledTimes(1)
      const [tenantId, input] = service.upsertForTenant.mock.calls[0]
      expect(tenantId).toBe('tenant-1')
      expect(input.clientId).toBe('client-2')
      expect(input.certificatePem).toContain('-----BEGIN CERTIFICATE-----')
      expect(input.privateKeyPem).toContain('-----BEGIN RSA PRIVATE KEY-----')
    })

    it('rifiuta un PKCS#12 con passphrase errata (400, niente segreti)', async () => {
      const dto: SetRentriCredentialDto = {
        clientId: 'client-3',
        pkcs12Base64: makePkcs12('giusta'),
        pkcs12Passphrase: 'sbagliata',
      }

      await expect(controller.set(dto, user)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('rifiuta se mancano sia i PEM sia il PKCS#12', async () => {
      const dto = { clientId: 'client-4' } as SetRentriCredentialDto

      await expect(controller.set(dto, user)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })
  })

  describe('GET (status)', () => {
    it('ritorna configured:false se non configurata', async () => {
      service.getForTenant.mockResolvedValue(null)

      const res = await controller.status(user)

      expect(res).toEqual({ configured: false })
    })

    it('ritorna solo metadati non sensibili (no chiave/cert)', async () => {
      service.getForTenant.mockResolvedValue({
        clientId: 'client-5',
        certificatePem: 'SECRET-CERT',
        privateKeyPem: 'SECRET-KEY',
        algorithm: 'RS256',
        environment: 'produzione',
      })

      const res = await controller.status(user)

      expect(res).toEqual({
        configured: true,
        clientId: 'client-5',
        environment: 'produzione',
      })
      const serialized = JSON.stringify(res)
      expect(serialized).not.toContain('SECRET-CERT')
      expect(serialized).not.toContain('SECRET-KEY')
    })
  })

  describe('DELETE (remove)', () => {
    it('rimuove la credenziale del tenant', async () => {
      const res = await controller.remove(user)

      expect(res).toEqual({ success: true })
      expect(service.removeForTenant).toHaveBeenCalledWith('tenant-1')
    })
  })
})
