import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
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
      /passphrase|non valido|non leggibile/i
    )
  })

  it('lancia un errore su contenuto non valido', () => {
    expect(() => parsePkcs12('non-un-pkcs12-valido!!', passphrase)).toThrow()
  })

  it('lancia un errore su contenuto vuoto', () => {
    expect(() => parsePkcs12('', passphrase)).toThrow(/non valido/i)
  })

  describe('chiavi EC (fixture versionate in tools/rentri-fake/test/fixture/ec)', () => {
    const dirFixture = path.resolve(__dirname, '../../../../../tools/rentri-fake/test/fixture/ec')
    const leggi = (nome: string) => fs.readFileSync(path.join(dirFixture, nome))

    it('p12 EC P-256 cifrato: chiave e certificato in PEM, tipoChiave ec, curva prime256v1', () => {
      const r = parsePkcs12(leggi('operatore-test-ec.p12'), 'prova-ec')

      expect(r.tipoChiave).toBe('ec')
      expect(r.curva).toBe('prime256v1')
      expect(r.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----')
      expect(r.certificatePem).toContain('-----BEGIN CERTIFICATE-----')
      // Il certificato restituito è quello foglia (non la CA allegata).
      expect(new crypto.X509Certificate(r.certificatePem).subject).toBe('CN=operatore-test-ec')
    })

    it('p12 EC senza password', () => {
      const r = parsePkcs12(leggi('operatore-test-ec-senza-password.p12'), '')

      expect(r.tipoChiave).toBe('ec')
      expect(r.curva).toBe('prime256v1')
    })

    it('p12 EC coi default di OpenSSL 3 (PBES2/PBKDF2/AES-256-CBC, MAC SHA-256)', () => {
      const r = parsePkcs12(leggi('operatore-test-ec-openssl3.p12'), 'prova-ec')

      expect(r.tipoChiave).toBe('ec')
      expect(r.curva).toBe('prime256v1')
      expect(new crypto.X509Certificate(r.certificatePem).subject).toBe('CN=operatore-test-ec')
    })

    it('p12 EC con keyBag non cifrato (con MAC e senza MAC)', () => {
      for (const [nome, pass] of [
        ['operatore-test-ec-keybag-in-chiaro.p12', 'prova-ec'],
        ['operatore-test-ec-keybag-in-chiaro-senza-mac.p12', ''],
      ]) {
        const r = parsePkcs12(leggi(nome), pass)

        expect(r.tipoChiave).toBe('ec')
        expect(r.curva).toBe('prime256v1')
        expect(new crypto.X509Certificate(r.certificatePem).subject).toBe('CN=operatore-test-ec')
      }
    })

    it('p12 EC con passphrase errata: messaggio generico di oggi', () => {
      expect(() => parsePkcs12(leggi('operatore-test-ec.p12'), 'sbagliata')).toThrow(
        'PKCS#12 non leggibile: file non valido oppure passphrase errata'
      )
    })

    it('p12 EC P-384: riconosciuto con la sua curva (il rifiuto spetta a chi usa il risultato)', () => {
      const r = parsePkcs12(leggi('operatore-test-ec384.p12'), 'prova-ec')

      expect(r.tipoChiave).toBe('ec')
      expect(r.curva).toBe('secp384r1')
    })

    it('p12 RSA esistente: invariato', () => {
      const fixture = makePkcs12(passphrase)

      const r = parsePkcs12(fixture.pkcs12Base64, passphrase)

      expect(r.tipoChiave).toBe('rsa')
      expect(r.curva).toBeUndefined()
      expect(r.privateKeyPem).toContain('-----BEGIN RSA PRIVATE KEY-----')
    })

    it('la chiave EC estratta firma e il certificato la verifica', () => {
      const r = parsePkcs12(leggi('operatore-test-ec.p12'), 'prova-ec')
      const dati = Buffer.from('dati da firmare')

      const firma = crypto.sign('sha256', dati, crypto.createPrivateKey(r.privateKeyPem))
      const pubblica = new crypto.X509Certificate(r.certificatePem).publicKey

      expect(crypto.verify('sha256', dati, pubblica, firma)).toBe(true)
    })
  })
})
