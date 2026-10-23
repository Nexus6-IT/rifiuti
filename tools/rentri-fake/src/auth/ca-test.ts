import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import forge from 'node-forge'

/**
 * CA di prova esplicita e fissa della fake (FEDELTA.md §5.2 punto 1).
 *
 * NON e' un segreto reale: e' materiale crittografico generato per questo
 * processo, il cui solo scopo e' emettere i certificati degli operatori che
 * la fake riconosce come "accreditati" presso RENTRI. Prima di questa
 * correzione la fake non aveva alcuna ancoraggio di fiducia: qualunque
 * certificato autofirmato al volo veniva accettato (v. verificaJwt in
 * ./jwt-verifier.ts). Ora un certificato e' attendibile solo se la sua firma
 * verifica contro la chiave pubblica di QUESTA CA.
 *
 * La coppia di chiavi e' generata una sola volta per processo (memoizzata):
 * "fissa" qui significa stabile per l'intera vita della fake, non
 * rigenerata ad ogni chiamata o ad ogni test all'interno dello stesso
 * processo Jest.
 */
interface CaDiProva {
  chiavePrivata: forge.pki.rsa.PrivateKey
  certificato: forge.pki.Certificate
}

let caMemoizzata: CaDiProva | null = null

function generaCa(commonName: string): CaDiProva {
  const coppia = forge.pki.rsa.generateKeyPair(2048)
  const certificato = forge.pki.createCertificate()

  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '00'
  certificato.validity.notBefore = new Date(Date.now() - 3_600_000)
  certificato.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000)

  const attributi = [
    { name: 'commonName', value: commonName },
    {
      name: 'organizationName',
      value: 'RENTRI Fake - materiale di prova, non un ente reale',
    },
  ]
  certificato.setSubject(attributi)
  certificato.setIssuer(attributi)
  certificato.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
  ])
  certificato.sign(coppia.privateKey, forge.md.sha256.create())

  return { chiavePrivata: coppia.privateKey, certificato }
}

function caDiProva(): CaDiProva {
  if (!caMemoizzata) {
    caMemoizzata = generaCa('RENTRI-FAKE-CA-TEST')
  }
  return caMemoizzata
}

/** Certificato della CA di prova, in PEM: usato da verificaJwt per validare la catena. */
export function certificatoCaPem(): string {
  return forge.pki.certificateToPem(caDiProva().certificato)
}

export interface CertificatoEmesso {
  chiavePrivataPem: string
  certificatoBase64Der: string
}

function emettiCertificatoFirmatoDa(
  commonName: string,
  certificatoEmittente: forge.pki.Certificate,
  chiavePrivataEmittente: forge.pki.rsa.PrivateKey,
  opzioni: { scadutoGiorniFa?: number }
): CertificatoEmesso {
  const coppia = forge.pki.rsa.generateKeyPair(2048)
  const certificato = forge.pki.createCertificate()
  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '01'

  if (opzioni.scadutoGiorniFa !== undefined) {
    // Certificato la cui intera finestra di validita' e' nel passato: un
    // caso di test, non una scadenza che sta per verificarsi.
    certificato.validity.notBefore = new Date(
      Date.now() - (opzioni.scadutoGiorniFa + 1) * 86_400_000
    )
    certificato.validity.notAfter = new Date(Date.now() - opzioni.scadutoGiorniFa * 86_400_000)
  } else {
    certificato.validity.notBefore = new Date(Date.now() - 60_000)
    certificato.validity.notAfter = new Date(Date.now() + 86_400_000)
  }

  certificato.setSubject([{ name: 'commonName', value: commonName }])
  certificato.setIssuer(certificatoEmittente.subject.attributes)
  certificato.sign(chiavePrivataEmittente, forge.md.sha256.create())

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificato)).getBytes()
  // node-forge esporta di default in PKCS#1 ("RSA PRIVATE KEY"), ma jose
  // (importPKCS8, usato nei test) richiede PKCS#8 ("PRIVATE KEY").
  const chiavePkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(coppia.privateKey))

  return {
    chiavePrivataPem: forge.pki.privateKeyInfoToPem(chiavePkcs8),
    certificatoBase64Der: forge.util.encode64(der),
  }
}

/**
 * Emette un certificato per un operatore, firmato dalla CA di prova fissa
 * della fake: e' il caso positivo che verificaJwt deve accettare.
 * `scadutoGiorniFa` produce un certificato la cui validita' e' interamente
 * nel passato (caso negativo: catena valida, ma certificato scaduto).
 */
export function emettiCertificatoAccreditato(
  commonName: string,
  opzioni: { scadutoGiorniFa?: number } = {}
): CertificatoEmesso {
  const ca = caDiProva()
  return emettiCertificatoFirmatoDa(commonName, ca.certificato, ca.chiavePrivata, opzioni)
}

/**
 * Emette un certificato firmato da una CA "estranea", generata al volo e
 * mai confrontata da verificaJwt: caso negativo distinto dall'autofirmato,
 * una catena reale ma verso l'ancora di fiducia sbagliata.
 */
export function emettiCertificatoAltraCa(commonName: string): CertificatoEmesso {
  const altraCa = generaCa('CA-ESTRANEA-TEST')
  return emettiCertificatoFirmatoDa(commonName, altraCa.certificato, altraCa.chiavePrivata, {})
}

/**
 * CA di prova RSA fissa dei certificati EC (test/fixture/ec/ca-prova.crt,
 * generata da scripts/genera-fixture-ec.sh): e' la CA che ha emesso il
 * certificato EC P-256 usato per provare ES256. Il simulatore si fida anche
 * di questa, oltre alla CA effimera di processo.
 *
 * La fixture sta in test/, che l'immagine Docker NON copia: se il file non
 * c'e' (build di produzione del finto) la CA fissa semplicemente non si
 * aggiunge e resta valida solo la CA effimera.
 */
const PERCORSO_CA_FISSA = join(__dirname, '..', '..', 'test', 'fixture', 'ec', 'ca-prova.crt')

/** PEM di tutte le CA di cui la fake si fida: effimera sempre, fissa se presente. */
export function certificatiCaAttendibiliPem(): string[] {
  const elenco = [certificatoCaPem()]
  if (existsSync(PERCORSO_CA_FISSA)) {
    elenco.push(readFileSync(PERCORSO_CA_FISSA, 'utf8'))
  }
  return elenco
}
