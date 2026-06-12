import * as forge from 'node-forge'
import { parsePkcs12 } from './rentri-pkcs12.util'

/**
 * Genera in test un PKCS#12 (base64) contenente un keypair RSA + certificato
 * self-signed protetto dalla passphrase data.
 */
function makePkcs12(passphrase: string): {
  pkcs12Base64: string
  certificatePem: string
  privateKeyPem: string
} {
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

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  })
  const der = forge.asn1.toDer(p12Asn1).getBytes()
  const pkcs12Base64 = forge.util.encode64(der)

  return {
    pkcs12Base64,
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

describe('parsePkcs12', () => {
  const passphrase = 'super-secret-pass'

  it('estrae cert + chiave in PEM da un PKCS#12 base64 (round-trip)', () => {
    const fixture = makePkcs12(passphrase)

    const result = parsePkcs12(fixture.pkcs12Base64, passphrase)

    expect(result.certificatePem).toContain('-----BEGIN CERTIFICATE-----')
    expect(result.privateKeyPem).toContain('-----BEGIN RSA PRIVATE KEY-----')

    // Round-trip: il certificato estratto combacia con quello originale.
    expect(result.certificatePem.trim()).toBe(fixture.certificatePem.trim())

    // Round-trip della chiave: ri-parsificata, la chiave estratta è equivalente
    // a quella originale (confronto sui parametri RSA, non sulla stringa raw).
    const original = forge.pki.privateKeyFromPem(fixture.privateKeyPem) as forge.pki.rsa.PrivateKey
    const extracted = forge.pki.privateKeyFromPem(result.privateKeyPem) as forge.pki.rsa.PrivateKey
    expect(extracted.n.toString(16)).toBe(original.n.toString(16))
    expect(extracted.d.toString(16)).toBe(original.d.toString(16))
  })

  it('accetta anche un Buffer DER come input', () => {
    const fixture = makePkcs12(passphrase)
    const buffer = Buffer.from(fixture.pkcs12Base64, 'base64')

    const result = parsePkcs12(buffer, passphrase)

    expect(result.certificatePem.trim()).toBe(fixture.certificatePem.trim())
  })

  it('lancia un errore chiaro con passphrase errata', () => {
    const fixture = makePkcs12(passphrase)

    expect(() => parsePkcs12(fixture.pkcs12Base64, 'passphrase-sbagliata')).toThrow(
      /passphrase|non valido|non leggibile/i,
    )
  })

  it('lancia un errore su contenuto non valido', () => {
    expect(() => parsePkcs12('non-un-pkcs12-valido!!', passphrase)).toThrow()
  })

  it('lancia un errore su contenuto vuoto', () => {
    expect(() => parsePkcs12('', passphrase)).toThrow(/non valido/i)
  })
})
