import forge from 'node-forge'
import { emettiCertificatoAccreditato, emettiCertificatoAltraCa } from '../../src/auth/ca-test'

export interface CertificatoDiTest {
  chiavePrivataPem: string
  certificatoBase64Der: string
}

/**
 * Caso positivo di default: certificato firmato dalla CA di prova fissa
 * della fake (`src/auth/ca-test.ts`), per un operatore accreditato. E' il
 * certificato che `verificaJwt` deve accettare.
 */
export function creaCertificatoDiTest(commonName = 'operatore-test'): CertificatoDiTest {
  return emettiCertificatoAccreditato(commonName)
}

/**
 * Caso negativo (FEDELTA.md §3.4, §5.2 punto 1): certificato autofirmato da
 * chiunque, non emesso dalla CA di prova. E' esattamente il difetto
 * originario dell'audit: un certificato del genere veniva accettato senza
 * alcun ancoraggio di fiducia.
 */
export function creaCertificatoAutofirmato(commonName = 'operatore-inventato'): CertificatoDiTest {
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
  const chiavePkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(coppia.privateKey))

  return {
    chiavePrivataPem: forge.pki.privateKeyInfoToPem(chiavePkcs8),
    certificatoBase64Der: forge.util.encode64(der),
  }
}

/**
 * Caso negativo: certificato emesso da una CA reale ma diversa da quella
 * fissa della fake. Distinto dall'autofirmato: qui la catena esiste, punta
 * solo all'ancora di fiducia sbagliata.
 */
export function creaCertificatoAltraCa(commonName = 'operatore-altra-ca'): CertificatoDiTest {
  return emettiCertificatoAltraCa(commonName)
}

/**
 * Caso negativo: certificato emesso dalla CA di prova della fake, ma la cui
 * intera finestra di validita' e' scaduta da `giorniFa` giorni (default 300,
 * il caso riportato in FEDELTA.md §3.4).
 */
export function creaCertificatoScaduto(
  commonName = 'operatore-scaduto',
  giorniFa = 300
): CertificatoDiTest {
  return emettiCertificatoAccreditato(commonName, { scadutoGiorniFa: giorniFa })
}
