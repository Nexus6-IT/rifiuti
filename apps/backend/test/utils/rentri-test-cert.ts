import * as forge from 'node-forge'

export interface TestCert {
  certificatePem: string
  privateKeyPem: string
  publicKeyPem: string
}

/**
 * Genera una coppia di chiavi RSA + certificato X.509 self-signed per i test
 * di firma JWS RENTRI (nessuna rete, nessun certificato reale richiesto).
 */
export function generateTestCert(): TestCert {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 60_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  const attrs = [{ name: 'commonName', value: 'rentri-test' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    publicKeyPem: forge.pki.publicKeyToPem(keys.publicKey),
  }
}
