import * as jwt from 'jsonwebtoken'
import { of } from 'rxjs'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { generateTestCert, TestCert } from '../../../test/utils/rentri-test-cert'

/**
 * Verifica il flusso OAuth2 ModI (client_assertion firmata X.509 →
 * access token Bearer) e la cache del token.
 */
describe('RentriAuthService', () => {
  let cert: TestCert
  let service: RentriAuthService
  let http: { post: jest.Mock }
  let logger: any

  beforeAll(() => {
    cert = generateTestCert()
  })

  const baseConfig = (): RentriConfig => ({
    mode: 'live',
    baseUrl: 'https://demoapi.rentri.gov.it',
    tokenUrl: 'https://demoapi.rentri.gov.it/token',
    clientId: 'operator-123',
    tokenAudience: 'https://demoapi.rentri.gov.it/token',
    signatureAudience: 'https://demoapi.rentri.gov.it',
    certificatePem: cert.certificatePem,
    privateKeyPem: cert.privateKeyPem,
    algorithm: 'RS256',
    mockApiKey: 'demo-key',
    jwtTtlSeconds: 300,
    credentialEncKey: 'test-enc-key',
  })

  let resolver: any

  beforeEach(() => {
    http = { post: jest.fn() }
    logger = { setContext: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }
    // Il resolver fornisce la credenziale del tenant corrente (qui: cert di test).
    resolver = {
      resolve: jest.fn().mockResolvedValue({
        clientId: 'operator-123',
        certificatePem: cert.certificatePem,
        privateKeyPem: cert.privateKeyPem,
        algorithm: 'RS256',
        source: 'env',
      }),
    }
    service = new RentriAuthService(http as any, baseConfig(), resolver, logger)
  })

  it('ottiene un access token inviando una client_assertion valida', async () => {
    http.post.mockReturnValue(of({ data: { access_token: 'AT-1', expires_in: 300 } }))

    const token = await service.getAccessToken()
    expect(token).toBe('AT-1')

    // Verifica i parametri del POST OAuth2
    const [url, bodyStr, opts] = http.post.mock.calls[0]
    expect(url).toBe('https://demoapi.rentri.gov.it/token')
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const form = new URLSearchParams(bodyStr)
    expect(form.get('grant_type')).toBe('client_credentials')
    expect(form.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    )

    // La client_assertion è un JWT firmato e verificabile col certificato
    const assertion = form.get('client_assertion') as string
    const decoded: any = jwt.verify(assertion, cert.publicKeyPem, { algorithms: ['RS256'] })
    expect(decoded.iss).toBe('operator-123')
    expect(decoded.sub).toBe('operator-123')
    expect(decoded.aud).toBe('https://demoapi.rentri.gov.it/token')
    expect(decoded.jti).toBeDefined()
  })

  it('riusa il token in cache senza richiamare il token endpoint', async () => {
    http.post.mockReturnValue(of({ data: { access_token: 'AT-1', expires_in: 300 } }))

    await service.getAccessToken()
    await service.getAccessToken()

    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('dopo invalidate() richiede un nuovo token', async () => {
    http.post
      .mockReturnValueOnce(of({ data: { access_token: 'AT-1', expires_in: 300 } }))
      .mockReturnValueOnce(of({ data: { access_token: 'AT-2', expires_in: 300 } }))

    const first = await service.getAccessToken()
    service.invalidate()
    const second = await service.getAccessToken()

    expect(first).toBe('AT-1')
    expect(second).toBe('AT-2')
    expect(http.post).toHaveBeenCalledTimes(2)
  })

  it('fallisce se il token endpoint non restituisce access_token', async () => {
    http.post.mockReturnValue(of({ data: {} }))
    await expect(service.getAccessToken()).rejects.toThrow('access_token')
  })
})
