import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import JSZip from 'jszip'
import forge from 'node-forge'
import { costruisciAsicE, MaterialeFirmaTest, MIMETYPE_ASICE } from './costruisci-asice'

/**
 * Test UNITARIO, senza dipendenze da `tools/rentri-fake` (che non e' un
 * workspace npm — v. commento di testata di `jest.config.js`): verifica la
 * FORMA del container prodotto, replicando indipendentemente (con lo stesso
 * `node-forge` gia' usato in produzione) i calcoli che
 * `tools/rentri-fake/src/xfir/validatore-xades.ts` fara' per riverificarli.
 *
 * La prova "accettato/rifiutato dal validatore VERO del finto" (la piu'
 * significativa) vive in `rentri-xfir.oracolo.spec.ts`, che gia' importa
 * `tools/rentri-fake` per montare la fake in-process: duplicarla qui
 * romperebbe la suite unitaria in CI ovunque la fake non sia installata.
 */
function materialeFirmaDiTest(): MaterialeFirmaTest {
  const coppia = forge.pki.rsa.generateKeyPair(1024)
  const certificato = forge.pki.createCertificate()
  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '01'
  certificato.validity.notBefore = new Date(Date.now() - 60_000)
  certificato.validity.notAfter = new Date(Date.now() + 86_400_000)
  const attributi = [{ name: 'commonName', value: 'firmatario-test-costruisci-asice' }]
  certificato.setSubject(attributi)
  certificato.setIssuer(attributi)
  certificato.sign(coppia.privateKey, forge.md.sha256.create())

  return {
    certificatoPem: forge.pki.certificateToPem(certificato),
    chiavePrivataPem: forge.pki.privateKeyToPem(coppia.privateKey),
  }
}

describe('costruisciAsicE', () => {
  it('rifiuta un container senza documenti (copertura vacua per il validatore)', async () => {
    await expect(costruisciAsicE({ documenti: [], firma: materialeFirmaDiTest() })).rejects.toThrow(
      /almeno un documento/
    )
  })

  it('rifiuta un nome file di documento dati riservato a META-INF/', async () => {
    await expect(
      costruisciAsicE({
        documenti: [{ nome: 'META-INF/intruso.xml', contenuto: '<x/>' }],
        firma: materialeFirmaDiTest(),
      })
    ).rejects.toThrow(/riservato a META-INF/)
  })

  it("mimetype e' il primo file dell'archivio, STORE (non compresso), contenuto esatto", async () => {
    const buffer = await costruisciAsicE({
      documenti: [{ nome: 'formulario.xml', contenuto: '<formulario/>' }],
      firma: materialeFirmaDiTest(),
    })

    const zip = await JSZip.loadAsync(buffer)
    const nomi = Object.keys(zip.files)
    expect(nomi[0]).toBe('mimetype')
    expect(await zip.files['mimetype'].async('string')).toBe(MIMETYPE_ASICE)

    // JSZip non riespone il metodo di compressione dopo un round-trip
    // loadAsync (`options.compression` torna sempre `null` in lettura): la
    // convenzione ASiC-E (mimetype non compresso) si verifica solo leggendo
    // il campo "compression method" del PRIMO Local File Header dello ZIP
    // grezzo (formato PKZIP: firma 4 byte 'PK\x03\x04', poi 2 byte versione,
    // 2 byte flag, 2 byte compression method — offset 8). 0 = STORE.
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50) // firma Local File Header
    expect(buffer.readUInt16LE(8)).toBe(0) // compression method = STORE
  })

  it('scrive ogni documento alla radice', async () => {
    const documenti = [
      { nome: 'formulario.xml', contenuto: '<formulario numeroFir="TEST00000001A"/>' },
      { nome: 'allegato-1.xml', contenuto: '<allegato id="1"/>' },
    ]
    const buffer = await costruisciAsicE({ documenti, firma: materialeFirmaDiTest() })

    const zip = await JSZip.loadAsync(buffer)
    for (const documento of documenti) {
      expect(await zip.files[documento.nome].async('string')).toBe(documento.contenuto)
    }
  })

  it('scrive META-INF/manifest.xml con una voce per ogni documento', async () => {
    const documenti = [
      { nome: 'formulario.xml', contenuto: '<formulario numeroFir="TEST00000001A"/>' },
      { nome: 'allegato-1.xml', contenuto: '<allegato id="1"/>' },
    ]
    const buffer = await costruisciAsicE({ documenti, firma: materialeFirmaDiTest() })

    const zip = await JSZip.loadAsync(buffer)
    const manifest = await zip.files['META-INF/manifest.xml']?.async('string')

    expect(manifest).toBeDefined()
    for (const documento of documenti) {
      expect(manifest).toContain(documento.nome)
    }
  })

  it('scrive una firma XAdES in META-INF/ con un ds:Reference per documento e digest SHA-256 corretti', async () => {
    const documenti = [
      { nome: 'formulario.xml', contenuto: '<formulario numeroFir="TEST00000002A"/>' },
      { nome: 'allegato-1.xml', contenuto: '<allegato id="1"/>' },
    ]
    const buffer = await costruisciAsicE({ documenti, firma: materialeFirmaDiTest() })

    const zip = await JSZip.loadAsync(buffer)
    const xmlFirma = await zip.files['META-INF/signatures.xml'].async('string')

    expect(xmlFirma).toContain('<ds:SignatureValue>')
    expect(xmlFirma).toContain('<ds:X509Certificate>')

    for (const documento of documenti) {
      const digestAtteso = forge.util.encode64(
        forge.md.sha256.create().update(documento.contenuto, 'utf8').digest().getBytes()
      )
      expect(xmlFirma).toContain(`<ds:Reference URI="${documento.nome}">`)
      expect(xmlFirma).toContain(`<ds:DigestValue>${digestAtteso}</ds:DigestValue>`)
    }
  })

  it('la SignatureValue e verificabile con la chiave pubblica del certificato dichiarato (stessa logica di validatore-xades.ts)', async () => {
    const documenti = [
      { nome: 'formulario.xml', contenuto: '<formulario numeroFir="TEST00000003A"/>' },
    ]
    const buffer = await costruisciAsicE({ documenti, firma: materialeFirmaDiTest() })

    const zip = await JSZip.loadAsync(buffer)
    const xmlFirma = await zip.files['META-INF/signatures.xml'].async('string')

    const signedInfo = xmlFirma.slice(
      xmlFirma.indexOf('<ds:SignedInfo'),
      xmlFirma.indexOf('</ds:SignedInfo>') + '</ds:SignedInfo>'.length
    )
    const signatureValue = /<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/.exec(xmlFirma)?.[1]
    const certificatoBase64 = /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/.exec(
      xmlFirma
    )?.[1]
    expect(signatureValue).toBeDefined()
    expect(certificatoBase64).toBeDefined()

    const certificato = forge.pki.certificateFromPem(
      `-----BEGIN CERTIFICATE-----\n${certificatoBase64}\n-----END CERTIFICATE-----`
    )
    const chiavePubblica = certificato.publicKey as forge.pki.rsa.PublicKey

    const md = forge.md.sha256.create()
    md.update(signedInfo, 'utf8')
    const firmaBytes = forge.util.decode64(signatureValue as string)

    expect(chiavePubblica.verify(md.digest().bytes(), firmaBytes)).toBe(true)
  })

  it('usa il nome file di firma custom quando indicato', async () => {
    const buffer = await costruisciAsicE({
      documenti: [{ nome: 'formulario.xml', contenuto: '<formulario/>' }],
      firma: { ...materialeFirmaDiTest(), nomeFileFirma: 'firma-fir.xml' },
    })

    const zip = await JSZip.loadAsync(buffer)
    expect(zip.files['META-INF/firma-fir.xml']).toBeDefined()
    expect(zip.files['META-INF/signatures.xml']).toBeUndefined()
  })

  describe('firma con chiave EC P-256 (fixture di prova)', () => {
    const dirFixture = path.resolve(
      __dirname,
      '../../../../../../tools/rentri-fake/test/fixture/ec'
    )
    const leggi = (nome: string) => fs.readFileSync(path.join(dirFixture, nome), 'utf8')

    async function estraiFirma(materiale: MaterialeFirmaTest) {
      const buffer = await costruisciAsicE({
        documenti: [
          { nome: 'formulario.xml', contenuto: '<formulario numeroFir="TEST00000004A"/>' },
        ],
        firma: materiale,
      })
      const zip = await JSZip.loadAsync(buffer)
      const xml = await zip.files['META-INF/signatures.xml'].async('string')
      return {
        xml,
        signedInfo: xml.slice(
          xml.indexOf('<ds:SignedInfo'),
          xml.indexOf('</ds:SignedInfo>') + '</ds:SignedInfo>'.length
        ),
        signatureValue: /<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/.exec(xml)?.[1] as string,
        certificatoBase64: /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/.exec(
          xml
        )?.[1] as string,
      }
    }

    it('ASiC con chiave EC: SignatureMethod ecdsa-sha256 e firma di 64 byte verificabile', async () => {
      const certificatoPem = leggi('operatore-test-ec.crt')
      const { xml, signedInfo, signatureValue, certificatoBase64 } = await estraiFirma({
        certificatoPem,
        chiavePrivataPem: leggi('operatore-test-ec.key'),
      })

      expect(xml).toContain('http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')
      expect(xml).not.toContain('rsa-sha256')

      const firma = Buffer.from(signatureValue, 'base64')
      expect(firma.length).toBe(64) // r||s IEEE P1363, non DER

      // Il certificato in KeyInfo e' quello fornito (stessi byte DER).
      const x509 = new crypto.X509Certificate(certificatoPem)
      expect(certificatoBase64).toBe(x509.raw.toString('base64'))
      expect(
        crypto.verify(
          'sha256',
          Buffer.from(signedInfo, 'utf8'),
          { key: x509.publicKey, dsaEncoding: 'ieee-p1363' },
          firma
        )
      ).toBe(true)
    })

    it('ASiC con chiave RSA: invariato', async () => {
      const { xml, signedInfo, signatureValue, certificatoBase64 } = await estraiFirma(
        materialeFirmaDiTest()
      )

      expect(xml).not.toContain('ecdsa-sha256')
      const firma = Buffer.from(signatureValue, 'base64')
      expect(firma.length).toBe(128) // RSA-1024 del materiale di test
      const chiavePubblica = new crypto.X509Certificate(
        `-----BEGIN CERTIFICATE-----\n${certificatoBase64}\n-----END CERTIFICATE-----`
      ).publicKey
      expect(crypto.verify('sha256', Buffer.from(signedInfo, 'utf8'), chiavePubblica, firma)).toBe(
        true
      )
    })
  })
})
