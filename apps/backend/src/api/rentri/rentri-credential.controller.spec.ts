import { BadRequestException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import * as fs from 'fs'
import * as path from 'path'
import * as forge from 'node-forge'
import { RentriCredentialController } from './rentri-credential.controller'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { SetRentriCredentialDto } from './dto/set-rentri-credential.dto'
import * as Sentry from '@sentry/node'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'admin',
  permissions: [],
}

// richiesta senza switch di azienda: l'azienda selezionata coincide con quella del token
const req = { tenantId: user.tenantId, user }

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

const dirFixtureEc = path.resolve(__dirname, '../../../../../tools/rentri-fake/test/fixture/ec')
const p12Base64 = (nome: string): string =>
  fs.readFileSync(path.join(dirFixtureEc, nome)).toString('base64')

describe('RentriCredentialController', () => {
  let controller: RentriCredentialController
  let service: jest.Mocked<RentriCredentialService>
  let modalita: { getForTenant: jest.Mock }
  let coda: { addSyncJob: jest.Mock }

  beforeEach(() => {
    service = {
      upsertForTenant: jest.fn().mockResolvedValue([]),
      getForTenant: jest.fn(),
      hasForTenant: jest.fn(),
      removeForTenant: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RentriCredentialService>

    modalita = { getForTenant: jest.fn() }
    coda = { addSyncJob: jest.fn().mockResolvedValue('job-1') }
    controller = new RentriCredentialController(service, modalita as any, coda as any)
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

      const res = await controller.set(dto, req)

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

      await controller.set(dto, req)

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

      await controller.set(dto, req)

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

      await expect(controller.set(dto, req)).rejects.toBeInstanceOf(BadRequestException)
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

      await expect(controller.set(dto, req)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('accetta un certificato valido ma self-signed, segnalando gli avvertimenti senza bloccare', async () => {
      const { certificatePem, privateKeyPem } = makePemPair()
      const dto: SetRentriCredentialDto = {
        clientId: 'client-self-signed',
        certificatePem,
        privateKeyPem,
      }

      const res = await controller.set(dto, req)

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

      const res = await controller.set(dto, req)

      expect(res.success).toBe(true)
      expect(service.upsertForTenant).toHaveBeenCalledTimes(1)
      const [tenantId, input] = service.upsertForTenant.mock.calls[0]
      expect(tenantId).toBe('tenant-1')
      expect(input.clientId).toBe('client-2')
      expect(input.certificatePem).toContain('-----BEGIN CERTIFICATE-----')
      expect(input.privateKeyPem).toContain('-----BEGIN RSA PRIVATE KEY-----')
    })

    it('caricamento p12 EC: algorithm salvato ES256', async () => {
      const dto: SetRentriCredentialDto = {
        clientId: 'client-ec',
        pkcs12Base64: p12Base64('operatore-test-ec.p12'),
        pkcs12Passphrase: 'prova-ec',
      }

      const res = await controller.set(dto, req)

      expect(res.success).toBe(true)
      expect(res.algorithm).toBe('ES256')
      expect(service.upsertForTenant.mock.calls[0][1].algorithm).toBe('ES256')
    })

    it('caricamento con algorithm RS256 su chiave EC → 400', async () => {
      const dto: SetRentriCredentialDto = {
        clientId: 'client-ec',
        pkcs12Base64: p12Base64('operatore-test-ec.p12'),
        pkcs12Passphrase: 'prova-ec',
        algorithm: 'RS256',
      }

      await expect(controller.set(dto, req)).rejects.toThrow(
        "L'algoritmo indicato (RS256) non corrisponde alla chiave del certificato (ES256)"
      )
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('caricamento p12 P-384 → 400 con messaggio', async () => {
      const dto: SetRentriCredentialDto = {
        clientId: 'client-ec',
        pkcs12Base64: p12Base64('operatore-test-ec384.p12'),
        pkcs12Passphrase: 'prova-ec',
      }

      await expect(controller.set(dto, req)).rejects.toThrow(
        'Tipo di chiave non supportato da RENTRI: EC secp384r1'
      )
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('PEM RSA senza algorithm: salvato RS256', async () => {
      const res = await controller.set({ clientId: 'c', ...makePemPair() }, req)

      expect(res.algorithm).toBe('RS256')
      expect(service.upsertForTenant.mock.calls[0][1].algorithm).toBe('RS256')
    })

    it('rifiuta un PKCS#12 con passphrase errata (400, niente segreti)', async () => {
      const dto: SetRentriCredentialDto = {
        clientId: 'client-3',
        pkcs12Base64: makePkcs12('giusta'),
        pkcs12Passphrase: 'sbagliata',
      }

      await expect(controller.set(dto, req)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })

    it('rifiuta se mancano sia i PEM sia il PKCS#12', async () => {
      const dto = { clientId: 'client-4' } as SetRentriCredentialDto

      await expect(controller.set(dto, req)).rejects.toBeInstanceOf(BadRequestException)
      expect(service.upsertForTenant).not.toHaveBeenCalled()
    })
  })

  describe('GET (status)', () => {
    it('ritorna configured:false se non configurata', async () => {
      service.getForTenant.mockResolvedValue(null)

      const res = await controller.status(req)

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

      const res = await controller.status(req)

      expect(res).toEqual({
        configured: true,
        clientId: 'client-5',
        environment: 'produzione',
        numIscrSito: 'OP1234ABC123456-RM1234',
        numIscrOperatore: 'MI00001234',
        credentialsIdFirmaRemota: 'CRED00001',
        algorithm: 'RS256',
      })
      const serialized = JSON.stringify(res)
      expect(serialized).not.toContain('SECRET-CERT')
      expect(serialized).not.toContain('SECRET-KEY')
    })
  })

  describe('DELETE (remove)', () => {
    it('rimuove la credenziale del tenant', async () => {
      const res = await controller.remove(req)

      expect(res).toEqual({ success: true })
      expect(service.removeForTenant).toHaveBeenCalledWith('tenant-1')
    })
  })

  describe('ripartenza dei FIR riaperti dal caricamento del certificato', () => {
    const dto = (): SetRentriCredentialDto => ({ clientId: 'client-1', ...makePemPair() })

    beforeEach(() => {
      service.upsertForTenant.mockResolvedValue(['fir-1', 'fir-2'])
    })

    it('AUTOMATICA: accoda i FIR riaperti, senza conferma, a priorita bassa', async () => {
      modalita.getForTenant.mockResolvedValue({
        modalitaLegame: 'AUTOMATICA',
        certificatoConfigurato: true,
      })

      await controller.set(dto(), req)

      expect(coda.addSyncJob).toHaveBeenCalledTimes(2)
      expect(coda.addSyncJob).toHaveBeenCalledWith({
        firId: 'fir-1',
        tenantId: 'tenant-1',
        richiedeConferma: false,
        priority: 'low',
      })
      expect(coda.addSyncJob).toHaveBeenCalledWith({
        firId: 'fir-2',
        tenantId: 'tenant-1',
        richiedeConferma: false,
        priority: 'low',
      })
    })

    it('IBRIDA: accoda i FIR riaperti con richiedeConferma', async () => {
      modalita.getForTenant.mockResolvedValue({
        modalitaLegame: 'IBRIDA',
        certificatoConfigurato: true,
      })

      await controller.set(dto(), req)

      expect(coda.addSyncJob).toHaveBeenCalledTimes(2)
      expect(coda.addSyncJob).toHaveBeenCalledWith(
        expect.objectContaining({ firId: 'fir-1', richiedeConferma: true, priority: 'low' })
      )
    })

    it('MANUALE: nessun accodamento (l utente preme «Trasmetti a RENTRI»)', async () => {
      modalita.getForTenant.mockResolvedValue({
        modalitaLegame: 'MANUALE',
        certificatoConfigurato: true,
      })

      await controller.set(dto(), req)

      expect(coda.addSyncJob).not.toHaveBeenCalled()
    })

    it('nessun FIR riaperto: non legge nemmeno la modalita', async () => {
      service.upsertForTenant.mockResolvedValue([])

      await controller.set(dto(), req)

      expect(modalita.getForTenant).not.toHaveBeenCalled()
      expect(coda.addSyncJob).not.toHaveBeenCalled()
    })

    it('errore di accodamento: il caricamento riesce comunque, errore segnalato', async () => {
      modalita.getForTenant.mockResolvedValue({
        modalitaLegame: 'AUTOMATICA',
        certificatoConfigurato: true,
      })
      coda.addSyncJob.mockRejectedValue(new Error('redis giu'))

      const res = await controller.set(dto(), req)

      expect(res.success).toBe(true)
      expect(Sentry.captureException).toHaveBeenCalled()
    })

    it('errore nella lettura della modalita: il caricamento riesce comunque', async () => {
      modalita.getForTenant.mockRejectedValue(new Error('db giu'))

      const res = await controller.set(dto(), req)

      expect(res.success).toBe(true)
      expect(coda.addSyncJob).not.toHaveBeenCalled()
    })
  })

  describe('DTO: credentialsIdFirmaRemota (ca-rentri.yaml: 9 caratteri)', () => {
    const erroriSuCredentialsId = async (valore: string) => {
      const dto = plainToInstance(SetRentriCredentialDto, {
        clientId: 'client-1',
        certificatePem: 'pem',
        privateKeyPem: 'key',
        credentialsIdFirmaRemota: valore,
      })
      const errori = await validate(dto)
      return errori.filter(e => e.property === 'credentialsIdFirmaRemota')
    }

    it.each(['12345678', '1234567890'])('rifiuta %s (non 9 caratteri)', async valore => {
      const errori = await erroriSuCredentialsId(valore)
      expect(errori).toHaveLength(1)
      expect(Object.values(errori[0].constraints ?? {})).toContain(
        "L'identificativo delle credenziali di firma remota deve avere 9 caratteri"
      )
    })

    it('accetta 9 caratteri', async () => {
      expect(await erroriSuCredentialsId('CRED00001')).toHaveLength(0)
    })
  })
})
