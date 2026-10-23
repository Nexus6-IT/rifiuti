import * as fs from 'fs'
import * as path from 'path'
import * as forge from 'node-forge'
import { validaCertificato } from './valida-certificato'

/** Genera un keypair RSA + certificato, con opzioni per i casi di test. */
function makeCert(opts: {
  giorniAllaScadenza?: number
  issuerKeys?: forge.pki.rsa.KeyPair
  issuerAttrs?: forge.pki.CertificateField[]
  conEstensioniRevoca?: boolean
  chiavePubblicaDiversa?: boolean
}): { certificatePem: string; privateKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  // Se chiediamo esplicitamente una chiave pubblica diversa da quella privata
  // (per simulare un .p12 malformato/accoppiato male), firmiamo il certificato
  // con una seconda coppia di chiavi e usiamo SOLO la privata della prima.
  const chiaviCertificato = opts.chiavePubblicaDiversa ? forge.pki.rsa.generateKeyPair(2048) : keys

  cert.publicKey = chiaviCertificato.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1)
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setDate(
    cert.validity.notAfter.getDate() + (opts.giorniAllaScadenza ?? 365)
  )

  const subjectAttrs = [{ name: 'commonName', value: 'rentri-test' }]
  cert.setSubject(subjectAttrs)
  cert.setIssuer(opts.issuerAttrs ?? subjectAttrs)

  if (opts.conEstensioniRevoca) {
    cert.setExtensions([
      {
        name: 'cRLDistributionPoints',
        value: forge.asn1
          .toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, []))
          .getBytes(),
      },
    ])
  }

  const chiaveFirmante = opts.issuerKeys ? opts.issuerKeys.privateKey : chiaviCertificato.privateKey
  cert.sign(chiaveFirmante, forge.md.sha256.create())

  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

describe('validaCertificato', () => {
  it('certificato valido, coerente, self-signed, senza estensioni di revoca: valido ma con avvertimenti', () => {
    const { certificatePem, privateKeyPem } = makeCert({})

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.valido).toBe(true)
    expect(risultato.controlli.scadenza.esito).toBe('ok')
    expect(risultato.controlli.coerenzaChiave.esito).toBe('ok')
    expect(risultato.controlli.catena.esito).toBe('avvertimento')
    expect(risultato.controlli.catena.messaggio).toMatch(/auto-firmato/i)
    expect(risultato.controlli.revoca.esito).toBe('avvertimento')
    expect(risultato.controlli.revoca.messaggio).toMatch(/non dichiara/i)
  })

  it('certificato emesso da una CA (non self-signed): avvertimento diverso sulla catena', () => {
    const ca = forge.pki.rsa.generateKeyPair(2048)
    const issuerAttrs = [{ name: 'commonName', value: 'rentri-ca-test' }]
    const { certificatePem, privateKeyPem } = makeCert({ issuerKeys: ca, issuerAttrs })

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.controlli.catena.esito).toBe('avvertimento')
    expect(risultato.controlli.catena.messaggio).toMatch(/un solo certificato|pkcs#12/i)
  })

  it('certificato con estensioni di revoca dichiarate: avvertimento informativo (non verifica)', () => {
    const { certificatePem, privateKeyPem } = makeCert({ conEstensioniRevoca: true })

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.controlli.revoca.esito).toBe('avvertimento')
    expect(risultato.controlli.revoca.messaggio).toMatch(/dichiara/i)
  })

  it('certificato scaduto: errore bloccante sulla scadenza', () => {
    const { certificatePem, privateKeyPem } = makeCert({ giorniAllaScadenza: -5 })

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.valido).toBe(false)
    expect(risultato.controlli.scadenza.esito).toBe('errore')
    expect(risultato.controlli.scadenza.messaggio).toMatch(/scadut/i)
  })

  it('certificato in scadenza entro 30 giorni: avvertimento, non blocca', () => {
    const { certificatePem, privateKeyPem } = makeCert({ giorniAllaScadenza: 10 })

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.valido).toBe(true)
    expect(risultato.controlli.scadenza.esito).toBe('avvertimento')
  })

  it('chiave privata non corrispondente al certificato: errore bloccante', () => {
    const { certificatePem, privateKeyPem } = makeCert({ chiavePubblicaDiversa: true })

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.valido).toBe(false)
    expect(risultato.controlli.coerenzaChiave.esito).toBe('errore')
    expect(risultato.controlli.coerenzaChiave.messaggio).toMatch(/non corrisponde/i)
  })

  it('PEM illeggibili: non lancia mai, riporta errore sui controlli che dipendono dal parsing', () => {
    const risultato = validaCertificato('non e un certificato', 'non e una chiave')

    expect(risultato.valido).toBe(false)
    expect(risultato.controlli.scadenza.esito).toBe('errore')
    expect(risultato.controlli.coerenzaChiave.esito).toBe('errore')
  })

  it('certificato EC: scadenza, catena e revoca valutati senza errori', () => {
    const dir = path.resolve(__dirname, '../../../../../../tools/rentri-fake/test/fixture/ec')
    const certificatePem = fs.readFileSync(path.join(dir, 'operatore-test-ec.crt'), 'utf8')
    const privateKeyPem = fs.readFileSync(path.join(dir, 'operatore-test-ec.key'), 'utf8')

    const risultato = validaCertificato(certificatePem, privateKeyPem)

    expect(risultato.valido).toBe(true)
    expect(risultato.controlli.scadenza.esito).not.toBe('errore')
    expect(risultato.controlli.coerenzaChiave.esito).toBe('ok')
    expect(risultato.controlli.catena.esito).toBe('avvertimento')
    expect(risultato.controlli.revoca.esito).toBe('avvertimento')
  })
})
