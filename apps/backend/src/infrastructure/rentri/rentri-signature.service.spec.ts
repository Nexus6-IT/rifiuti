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
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operator-123',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem: cert.certificatePem,
      privateKeyPem: cert.privateKeyPem,
      algorithm: 'RS256',
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
    }
    const resolver: any = {
      resolve: jest.fn().mockResolvedValue({
        clientId: 'operator-123',
        certificatePem: cert.certificatePem,
        privateKeyPem: cert.privateKeyPem,
        algorithm: 'RS256',
        source: 'tenant',
      }),
    }
    service = new RentriSignatureService(config, resolver)
  })

  it('calcola il digest SHA-256 del body in formato RFC 3230', () => {
    const body = '{"a":1}'
    const expected = `SHA-256=${createHash('sha256').update(body, 'utf8').digest('base64')}`
    expect(service.computeDigest(body)).toBe(expected)
  })

  it('produce header Digest + Agid-JWT-Signature firmati e verificabili', async () => {
    const body = JSON.stringify({ firId: 'fir-1', quantita: 100 })
    const headers = await service.buildIntegrityHeaders(body, 'tenant-a')

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

  it('include la catena x5c negli header JOSE', async () => {
    const headers = await service.buildIntegrityHeaders('{"x":1}', 'tenant-a')
    const token = headers[RentriSignatureService.SIGNATURE_HEADER]
    const decodedComplete: any = jwt.decode(token, { complete: true })

    expect(decodedComplete.header.typ).toBe('JWT')
    expect(decodedComplete.header.alg).toBe('RS256')
    expect(decodedComplete.header.x5c).toEqual(pemChainToX5c(cert.certificatePem))
  })

  it('buildIntegrityHeaders con tenant esplicito e senza TenantContext usa la credenziale del tenant', async () => {
    const altro = generateTestCert()
    const resolver: any = {
      resolve: jest.fn().mockImplementation(async (tenantId: string) => ({
        clientId: tenantId === 'tenant-a' ? 'operatore-a' : 'operatore-env',
        certificatePem: tenantId === 'tenant-a' ? altro.certificatePem : cert.certificatePem,
        privateKeyPem: tenantId === 'tenant-a' ? altro.privateKeyPem : cert.privateKeyPem,
        algorithm: 'RS256',
        source: 'tenant',
      })),
    }
    const config: any = {
      signatureAudience: 'https://demoapi.rentri.gov.it',
      jwtTtlSeconds: 300,
    }
    const svc = new RentriSignatureService(config, resolver)

    // fuori da TenantContext.run: come in un worker BullMQ
    const headers = await svc.buildIntegrityHeaders('{"x":1}', 'tenant-a')

    expect(resolver.resolve).toHaveBeenCalledWith('tenant-a')
    const token = headers[RentriSignatureService.SIGNATURE_HEADER]
    const decoded: any = jwt.verify(token, altro.publicKeyPem, { algorithms: ['RS256'] })
    expect(decoded.iss).toBe('operatore-a')
    const complete: any = jwt.decode(token, { complete: true })
    expect(complete.header.x5c).toEqual(pemChainToX5c(altro.certificatePem))
  })

  it('buildIntegrityHeaders con tenant vuoto → errore', async () => {
    await expect(service.buildIntegrityHeaders('{"x":1}', '')).rejects.toThrow(
      'Firma di integrità RENTRI senza tenant'
    )
  })
})
