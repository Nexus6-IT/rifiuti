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

/** Genera un keypair RSA + certificato self-signed di test, con scadenza configurabile. */
function makeCertificato(giorniAllaScadenza = 365): {
  keys: forge.pki.rsa.KeyPair
  cert: forge.pki.Certificate
} {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1)
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + giorniAllaScadenza)
  const attrs = [{ name: 'commonName', value: 'rentri-test' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { keys, cert }
}

/** Genera un PKCS#12 base64 di test (keypair RSA + cert self-signed). */
function makePkcs12(passphrase: string): string {
  const { keys, cert } = makeCertificato()
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' })
  return forge.util.encode64(forge.asn1.toDer(asn1).getBytes())
}

/** Genera una coppia PEM (certificato + chiave privata coerenti) di test. */
function makePemPair(giorniAllaScadenza = 365): { certificatePem: string; privateKeyPem: string } {
  const { keys, cert } = makeCertificato(giorniAllaScadenza)
  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
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
      const { certificatePem, privateKeyPem } = makePemPair()
      const dto: SetRentriCredentialDto = {
        clientId: 'client-1',
        certificatePem,
        privateKeyPem,
        algorithm: 'RS256',
        environment: 'demo',
      }

      const res = await controller.set(dto, user)

      expect(res.success).toBe(true)
      expect(service.upsertForTenant).toHaveBeenCalledWith('tenant-1', {
        clientId: 'client-1',
        certificatePem: dto.certificatePem,
        privateKeyPem: dto.privateKeyPem,
        algorithm: 'RS256',
        environment: 'demo',
        numIscrSito: undefined,
        numIscrOperatore: undefined,
      })
    })

    it('salva anche il numIscrSito (unità locale RENTRI) quando fornito', async () => {
      const { certificatePem, privateKeyPem } = makePemPair()
      const dto: SetRentriCredentialDto = {
        clientId: 'client-1',
        certificatePem,
        privateKeyPem,
        numIscrSito: 'OP1234ABC123456-RM1234',
      }

      await controller.set(dto, user)

      expect(service.upsertForTenant).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ numIscrSito: 'OP1234ABC123456-RM1234' })
      )
    })

    it('salva anche il numIscrOperatore (R4 Task 3) quando fornito', async () => {
      const { certificatePem, privateKeyPem } = makePemPair()
      const dto: SetRentriCredentialDto = {
        clientId: 'client-1',
        certificatePem,
        privateKeyPem,
        numIscrOperatore: 'MI00001234',
      }

      await controller.set(dto, user)

      expect(service.upsertForTenant).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ numIscrOperatore: 'MI00001234' })
      )
    })

    it('rifiuta un certificato scaduto (400), senza salvare nulla', async () => {
      const { certificatePem, privateKeyPem } = makePemPair(-5)
      const dto: SetRentriCredentialDto = {
        clientId: 'client-scaduto',
        certificatePem,
        privateKeyPem,
      }

      await expect(controller.set(dto, user)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('rifiuta una chiave privata non coerente col certificato (400)', async () => {
      const { certificatePem } = makePemPair()
      const altraChiave = forge.pki.rsa.generateKeyPair(2048)
      const dto: SetRentriCredentialDto = {
        clientId: 'client-incoerente',
        certificatePem,
        privateKeyPem: forge.pki.privateKeyToPem(altraChiave.privateKey),
      }

      await expect(controller.set(dto, user)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('accetta un certificato valido ma self-signed, segnalando gli avvertimenti senza bloccare', async () => {
      const { certificatePem, privateKeyPem } = makePemPair()
      const dto: SetRentriCredentialDto = {
        clientId: 'client-self-signed',
        certificatePem,
        privateKeyPem,
      }

      const res = await controller.set(dto, user)

      expect(res.success).toBe(true)
      expect(service.upsertForTenant).toHaveBeenCalledTimes(1)
      expect(res.avvertimenti).toBeDefined()
      expect(res.avvertimenti!.length).toBeGreaterThan(0)
    })

    it('salva la credenziale da PKCS#12 (convertito in PEM)', async () => {
      const passphrase = 'pw-123'
      const dto: SetRentriCredentialDto = {
        clientId: 'client-2',
        pkcs12Base64: makePkcs12(passphrase),
        pkcs12Passphrase: passphrase,
      }

      const res = await controller.set(dto, user)

      expect(res.success).toBe(true)
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
        numIscrSito: 'OP1234ABC123456-RM1234',
        numIscrOperatore: 'MI00001234',
        // R3 Task 3: identificativo delle credenziali di firma remota. NON è
        // un segreto (la chiave privata resta custodita da RENTRI e non
        // transita mai da noi), quindi è legittimo esporlo — le due
        // asserzioni sotto continuano comunque a garantire che certificato e
        // chiave privata non escano mai da questo endpoint.
        credentialsIdFirmaRemota: 'CRED00001',
      })

      const res = await controller.status(user)

      expect(res).toEqual({
        configured: true,
        clientId: 'client-5',
        environment: 'produzione',
        numIscrSito: 'OP1234ABC123456-RM1234',
        numIscrOperatore: 'MI00001234',
        credentialsIdFirmaRemota: 'CRED00001',
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
