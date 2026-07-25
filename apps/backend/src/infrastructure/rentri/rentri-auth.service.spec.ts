import * as jwt from 'jsonwebtoken'
import { HttpService } from '@nestjs/axios'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { generateTestCert, TestCert } from '../../../test/utils/rentri-test-cert'

/**
 * Verifica l'autenticazione RENTRI ID_AUTH_REST_02 in direct trust: il JWT è
 * self-issued, firmato localmente con il certificato dell'operatore (nessuna
 * chiamata di rete, nessun token da mettere in cache).
 */
describe('RentriAuthService', () => {
  let cert: TestCert
  let service: RentriAuthService
  let credentialService: { getForTenant: jest.Mock }
  let logger: any

  beforeAll(() => {
    cert = generateTestCert()
  })

  const baseConfig = (overrides: Partial<RentriConfig> = {}): RentriConfig => ({
    baseUrl: 'https://demoapi.rentri.gov.it',
    clientId: 'env-operator',
    audience: 'rentrigov.demo.api',
    signatureAudience: 'https://demoapi.rentri.gov.it',
    certificatePem: '',
    privateKeyPem: '',
    algorithm: 'RS256',
    jwtTtlSeconds: 300,
    credentialEncKey: 'test-enc-key',
    ...overrides,
  })

  beforeEach(() => {
    logger = { setContext: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }
    credentialService = { getForTenant: jest.fn() }
  })

  function makeService(config: RentriConfig = baseConfig()) {
    return new RentriAuthService(credentialService as any, config, logger)
  }

  describe('JWT self-issued (ID_AUTH_REST_02)', () => {
    beforeEach(() => {
      credentialService.getForTenant.mockResolvedValue({
        clientId: 'operatore-test',
        certificatePem: cert.certificatePem,
        privateKeyPem: cert.privateKeyPem,
        algorithm: 'RS256',
        environment: 'demo',
      })
      service = makeService()
    })

    it('produce un header Authorization Bearer con un JWT firmato RS256 e x5c del certificato', async () => {
      const header = await service.creaAuthorizationHeader('tenant-1')

      expect(header.startsWith('Bearer ')).toBe(true)
      const token = header.replace('Bearer ', '')

      const decodedComplete: any = jwt.decode(token, { complete: true })
      expect(decodedComplete.header.alg).toBe('RS256')
      expect(decodedComplete.header.x5c).toBeDefined()
      expect(decodedComplete.header.x5c.length).toBeGreaterThan(0)

      // Verificabile con la chiave pubblica del certificato del tenant
      const decoded: any = jwt.verify(token, cert.publicKeyPem, { algorithms: ['RS256'] })
      expect(decoded).toBeDefined()
    })

    it("l'aud è esattamente il valore configurato", async () => {
      const header = await service.creaAuthorizationHeader('tenant-1')
      const token = header.replace('Bearer ', '')
      const decoded: any = jwt.verify(token, cert.publicKeyPem, { algorithms: ['RS256'] })

      expect(decoded.aud).toBe('rentrigov.demo.api')
    })

    it("iss e sub corrispondono all'identificativo operatore della credenziale del tenant", async () => {
      const header = await service.creaAuthorizationHeader('tenant-1')
      const token = header.replace('Bearer ', '')
      const decoded: any = jwt.verify(token, cert.publicKeyPem, { algorithms: ['RS256'] })

      expect(decoded.iss).toBe('operatore-test')
      expect(decoded.sub).toBe('operatore-test')
    })

    it('include iat, exp (finestra non superiore a 5 minuti) e jti', async () => {
      const header = await service.creaAuthorizationHeader('tenant-1')
      const token = header.replace('Bearer ', '')
      const decoded: any = jwt.verify(token, cert.publicKeyPem, { algorithms: ['RS256'] })

      expect(decoded.iat).toBeDefined()
      expect(decoded.exp).toBeDefined()
      expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(300)
      expect(decoded.jti).toBeDefined()
    })

    it('il jti è diverso ad ogni chiamata', async () => {
      const header1 = await service.creaAuthorizationHeader('tenant-1')
      const header2 = await service.creaAuthorizationHeader('tenant-1')

      const decoded1: any = jwt.verify(header1.replace('Bearer ', ''), cert.publicKeyPem, {
        algorithms: ['RS256'],
      })
      const decoded2: any = jwt.verify(header2.replace('Bearer ', ''), cert.publicKeyPem, {
        algorithms: ['RS256'],
      })

      expect(decoded1.jti).not.toBe(decoded2.jti)
    })

    it('non effettua alcuna richiesta HTTP per produrre il token', async () => {
      // Finta HTTP: se il servizio provasse a contattare la rete (es. un
      // endpoint /token) il test fallisce, perché il JWT è self-issued.
      const postSpy = jest.spyOn(HttpService.prototype, 'post').mockImplementation(() => {
        throw new Error('non deve essere effettuata alcuna richiesta HTTP')
      })
      const getSpy = jest.spyOn(HttpService.prototype, 'get').mockImplementation(() => {
        throw new Error('non deve essere effettuata alcuna richiesta HTTP')
      })

      try {
        await expect(service.creaAuthorizationHeader('tenant-1')).resolves.toBeDefined()
      } finally {
        postSpy.mockRestore()
        getSpy.mockRestore()
      }

      expect(postSpy).not.toHaveBeenCalled()
      expect(getSpy).not.toHaveBeenCalled()
    })
  })

  describe('risoluzione della credenziale', () => {
    it('usa il certificato di fallback da env se il tenant non ha una credenziale configurata', async () => {
      credentialService.getForTenant.mockResolvedValue(null)
      const config = baseConfig({
        clientId: 'env-operator',
        certificatePem: cert.certificatePem,
        privateKeyPem: cert.privateKeyPem,
      })
      service = makeService(config)

      const header = await service.creaAuthorizationHeader('tenant-senza-credenziale')
      const token = header.replace('Bearer ', '')
      const decoded: any = jwt.verify(token, cert.publicKeyPem, { algorithms: ['RS256'] })

      expect(decoded.iss).toBe('env-operator')
    })

    it('lancia se non c’è né credenziale del tenant né fallback da env', async () => {
      credentialService.getForTenant.mockResolvedValue(null)
      service = makeService(baseConfig({ certificatePem: '', privateKeyPem: '' }))

      await expect(service.creaAuthorizationHeader('tenant-senza-nulla')).rejects.toThrow(
        'nessuna credenziale'
      )
    })
  })

  describe('cambio di modello: nessun endpoint /token', () => {
    it('non espone più alcun metodo che contatti un token endpoint (getAccessToken/invalidate rimossi)', () => {
      credentialService.getForTenant.mockResolvedValue({
        clientId: 'operatore-test',
        certificatePem: cert.certificatePem,
        privateKeyPem: cert.privateKeyPem,
        algorithm: 'RS256',
        environment: 'demo',
      })
      service = makeService()

      expect((service as any).getAccessToken).toBeUndefined()
      expect((service as any).invalidate).toBeUndefined()
    })
  })
})
