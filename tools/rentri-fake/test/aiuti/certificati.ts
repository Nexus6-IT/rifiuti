import forge from 'node-forge'

/**
 * Genera una coppia chiave/certificato autofirmata per i test.
 * Il certificato serve a popolare l'header x5c del JWT self-issued.
 */
export function creaCertificatoDiTest(commonName = 'operatore-test'): {
  chiavePrivataPem: string
  certificatoBase64Der: string
} {
  const coppia = forge.pki.rsa.generateKeyPair(2048)
  const certificato = forge.pki.createCertificate()

  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '01'
  certificato.validity.notBefore = new Date(Date.now() - 60_000)
  certificato.validity.notAfter = new Date(Date.now() + 86_400_000)

  const attributi = [{ name: 'commonName', value: commonName }]
  certificato.setSubject(attributi)
  certificato.setIssuer(attributi)
  certificato.sign(coppia.privateKey, forge.md.sha256.create())

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificato)).getBytes()

  // node-forge esporta di default in PKCS#1 ("RSA PRIVATE KEY"), ma la
  // libreria jose usata nei test (importPKCS8) richiede PKCS#8
  // ("PRIVATE KEY"): avvolgiamo la chiave nella struttura PrivateKeyInfo.
  const chiavePkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(coppia.privateKey))

  return {
    chiavePrivataPem: forge.pki.privateKeyInfoToPem(chiavePkcs8),
    certificatoBase64Der: forge.util.encode64(der),
  }
}
