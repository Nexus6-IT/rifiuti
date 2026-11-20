import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { SignedXml } from 'xml-crypto'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { intestazioniAutenticate } from './aiuti/token'

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ALG_ENVELOPED = `${NS_DS}enveloped-signature`
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const REGISTRO = 'R1234ABCDEF'
const DIGEST_EREGI = 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c='

const EC_DIR = path.resolve(__dirname, 'fixture/ec')

interface Chiave {
  privata: string
  certificatoPem: string
  algoritmo: string
}

function chiaveEc(): Chiave {
  return {
    privata: fs.readFileSync(path.join(EC_DIR, 'operatore-test-ec.key'), 'utf8'),
    certificatoPem: fs.readFileSync(path.join(EC_DIR, 'operatore-test-ec.crt'), 'utf8'),
    algoritmo: 'ecdsa-sha256',
  }
}

function chiaveRsa(): Chiave {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const pem = `-----BEGIN CERTIFICATE-----\n${certificatoBase64Der.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  return { privata: chiavePrivataPem, certificatoPem: pem, algoritmo: 'rsa-sha256' }
}

class EcdsaSha256 {
  getSignature(dati: string, chiave: crypto.KeyLike): string {
    return crypto
      .sign('sha256', Buffer.from(dati), { key: chiave, dsaEncoding: 'ieee-p1363' } as never)
      .toString('base64')
  }
  verifySignature(): boolean {
    return false
  }
  getAlgorithmName(): string {
    return 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'
  }
}

function eregi(digest: string): string {
  return (
    `<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="eREGI-CS-0"><reg:Identificativo>${REGISTRO}</reg:Identificativo>` +
    `<ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${ALG_C14N}"/>` +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    `<ds:Reference URI="#eREGI-CS-0"><ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>` +
    '</ds:SignedInfo><ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature></reg:eREGI>'
  )
}

function registro(refDigest: string): string {
  return (
    `<reg:Registro xmlns:reg="${NS_REG}">${eregi(DIGEST_EREGI)}` +
    `<reg:RiferimentiPrecedenti><reg:Ref DigestValue="${refDigest}" DataCreazione="2026-01-02T08:00:00Z"/></reg:RiferimentiPrecedenti>` +
    '<reg:Registrazioni Anno="2026" ProgressivoDa="1" ProgressivoA="1" NumeroRegistrazioni="1" DataCreazione="2026-04-01T00:00:00Z"/>' +
    '</reg:Registro>'
  )
}

function firma(xml: string, chiave: Chiave): string {
  const firmatore = new SignedXml({
    privateKey: chiave.privata,
    signatureAlgorithm: `http://www.w3.org/2001/04/xmldsig-more#${chiave.algoritmo}`,
    canonicalizationAlgorithm: ALG_C14N,
    getKeyInfoContent: () =>
      `<ds:X509Data><ds:X509Certificate>${new crypto.X509Certificate(chiave.certificatoPem).raw.toString('base64')}</ds:X509Certificate></ds:X509Data>`,
  })
  if (chiave.algoritmo === 'ecdsa-sha256') {
    firmatore.SignatureAlgorithms['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'] =
      EcdsaSha256 as never
  }
  firmatore.addReference({
    xpath: '/*',
    isEmptyUri: true,
    transforms: [ALG_ENVELOPED, ALG_C14N],
    digestAlgorithm: ALG_SHA256,
  })
  firmatore.computeSignature(xml, { prefix: 'ds', location: { reference: '/*', action: 'append' } })
  // Solo la firma e' inserita a mano: il resto del documento resta com'e'.
  const chiusura = '</reg:Registro>'
  return xml.slice(0, -chiusura.length) + firmatore.getSignatureXml() + chiusura
}

describe('POST /operatore/{registro}/valida: firma XMLDSig e catena dei digest (eREGI E5)', () => {
  const app = creaApp()
  beforeAll(async () => {
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  async function valida(xml: string, nomeFile = 'registro.xml'): Promise<{ errore: boolean; validazione: { tipo: string; codice_messaggio: string }[] }> {
    await app.inject({
      method: 'POST',
      url: '/__controllo/dati-registri/registro',
      payload: { identificativo_registro: REGISTRO },
    })
    const risposta = await app.inject({
      method: 'POST',
      url: `/dati-registri/v1.0/operatore/${REGISTRO}/valida`,
      headers: await intestazioniAutenticate(),
      payload: { file_content: Buffer.from(xml).toString('base64'), nome_file: nomeFile, mime: 'application/xml' },
    })
    expect(risposta.statusCode).toBe(202)
    const id = risposta.json().transazione_id
    await app.inject({
      method: 'POST',
      url: '/__controllo/dati-registri/completa-transazione',
      payload: { transazione_id: id, errore: false, validazione: [] },
    })
    const esito = await app.inject({
      method: 'GET',
      url: `/dati-registri/v1.0/${id}/result`,
      headers: await intestazioniAutenticate(),
    })
    return esito.json()
  }

  it('registro non firmato: avvertimento firmaNonPresente, nessun errore', async () => {
    const esito = await valida(registro(DIGEST_EREGI))
    expect(esito.errore).toBe(false)
    expect(esito.validazione).toEqual([{ tipo: 'Avvertimento', codice_messaggio: 'firmaNonPresente' }])
  })

  describe.each([
    ['EC P-256', chiaveEc],
    ['RSA', chiaveRsa],
  ])('firma %s', (_nome, chiave) => {
    it('firma e catena corrette: nessun messaggio', async () => {
      const esito = await valida(firma(registro(DIGEST_EREGI), chiave()))
      expect(esito).toMatchObject({ errore: false, validazione: [] })
    })

    it('una virgola cambiata dopo la firma: firmaNonValida', async () => {
      const xml = firma(registro(DIGEST_EREGI), chiave()).replace('ProgressivoDa="1"', 'ProgressivoDa="2"')
      const esito = await valida(xml)
      expect(esito.errore).toBe(true)
      expect(esito.validazione).toContainEqual({ tipo: 'Errore', codice_messaggio: 'firmaNonValida' })
    })

    it('Ref[0] diverso dal digest dell eREGI rilasciato: catenaDigestNonValida', async () => {
      const esito = await valida(firma(registro('AAAA'), chiave()))
      expect(esito.errore).toBe(true)
      expect(esito.validazione).toEqual([{ tipo: 'Errore', codice_messaggio: 'catenaDigestNonValida' }])
    })
  })

  it('un file che non e un reg:Registro non riceve alcun giudizio (comportamento invariato)', async () => {
    const esito = await valida('<registro></registro>')
    expect(esito).toMatchObject({ errore: false, validazione: [] })
  })
})
