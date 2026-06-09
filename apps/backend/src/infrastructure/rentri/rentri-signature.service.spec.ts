import * as jwt from 'jsonwebtoken'
import { createHash } from 'crypto'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriConfig } from './rentri-config'
import { pemChainToX5c } from './rentri-jws.util'
import { generateTestCert, TestCert } from '../../../test/utils/rentri-test-cert'

/**
 * Verifica la firma di integrità AgID INTEGRITY_REST_02 (header
 * `Agid-JWT-Signature`) e il digest RFC 3230 del body.
 */
describe('RentriSignatureService', () => {
  let cert: TestCert
  let service: RentriSignatureService

  beforeAll(() => {
    cert = generateTestCert()
  })

  beforeEach(() => {
    const config: RentriConfig = {
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
    }
    service = new RentriSignatureService(config)
  })

  it('calcola il digest SHA-256 del body in formato RFC 3230', () => {
    const body = '{"a":1}'
    const expected = `SHA-256=${createHash('sha256').update(body, 'utf8').digest('base64')}`
    expect(service.computeDigest(body)).toBe(expected)
  })

  it('produce header Digest + Agid-JWT-Signature firmati e verificabili', () => {
    const body = JSON.stringify({ firId: 'fir-1', quantita: 100 })
    const headers = service.buildIntegrityHeaders(body)

    expect(headers['Digest']).toBe(service.computeDigest(body))
    const token = headers[RentriSignatureService.SIGNATURE_HEADER]
    expect(token).toBeDefined()

    // La firma è verificabile con la chiave pubblica del certificato
    const decoded: any = jwt.verify(token, cert.publicKeyPem, { algorithms: ['RS256'] })
    expect(decoded.aud).toBe('https://demoapi.rentri.gov.it')
    expect(decoded.iss).toBe('operator-123')

    // signed_headers contiene il digest del body effettivo (anti-tampering)
    const digestEntry = decoded.signed_headers.find((h: any) => h.digest)
    expect(digestEntry.digest).toBe(headers['Digest'])
  })

  it('include la catena x5c negli header JOSE', () => {
    const headers = service.buildIntegrityHeaders('{"x":1}')
    const token = headers[RentriSignatureService.SIGNATURE_HEADER]
    const decodedComplete: any = jwt.decode(token, { complete: true })

    expect(decodedComplete.header.typ).toBe('JWT')
    expect(decodedComplete.header.alg).toBe('RS256')
    expect(decodedComplete.header.x5c).toEqual(pemChainToX5c(cert.certificatePem))
  })
})
