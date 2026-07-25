import JSZip from 'jszip'
import forge from 'node-forge'

export interface SpecificaFirma {
  nomeFile: string
  copre: string[]
  /** Caso negativo: DigestValue deliberatamente errato (non corrisponde al contenuto). */
  digestErrato?: boolean
  /** Caso negativo: SignatureValue manomesso dopo la firma (verifica crittografica deve fallire). */
  firmaCorrotta?: boolean
}

/**
 * Costruisce un container ASiC-E strutturalmente corretto, con firme XAdES
 * detached che referenziano i file indicati in `copre`. A differenza della
 * versione precedente, `DigestValue` e' un digest SHA-256 reale del
 * contenuto referenziato e `SignatureValue` e' una firma RSA reale sul
 * blocco `SignedInfo`, verificabile con la chiave pubblica del certificato
 * incluso in `KeyInfo/X509Certificate`. Le opzioni `digestErrato` e
 * `firmaCorrotta` producono deliberatamente i casi negativi.
 */
export async function creaContainerXfir(opzioni: {
  xml: string[]
  firme: SpecificaFirma[]
  conMimetype?: boolean
}): Promise<Buffer> {
  const zip = new JSZip()

  if (opzioni.conMimetype !== false) {
    zip.file('mimetype', 'application/vnd.etsi.asic-e+zip')
  }

  const contenuti = new Map<string, string>()
  for (const nome of opzioni.xml) {
    const contenuto = `<?xml version="1.0" encoding="UTF-8"?><documento nome="${nome}"/>`
    contenuti.set(nome, contenuto)
    zip.file(nome, contenuto)
  }

  for (const firma of opzioni.firme) {
    zip.file(`META-INF/${firma.nomeFile}`, costruisciXmlFirma(firma, contenuti))
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}

function costruisciXmlFirma(firma: SpecificaFirma, contenuti: Map<string, string>): string {
  // Certificato "firmatario" ad hoc: autofirmato di proposito, perche' qui
  // si verifica solo la validita' crittografica della firma XAdES rispetto
  // al certificato che essa stessa dichiara (FEDELTA.md §5.2 punto 6), non
  // la catena di fiducia del firmatario (fuori scopo per l'xFIR, a
  // differenza della CA fissa usata per l'autenticazione JWT).
  // 1024 bit: la generazione RSA di node-forge e' pura JS e sincrona, e
  // qui viene invocata una volta per firma nei test. La dimensione della
  // chiave e' irrilevante per cio' che si sta esercitando (la correttezza
  // della verifica digest/firma, non la robustezza crittografica di un
  // materiale che comunque non e' mai un segreto reale).
  const coppia = forge.pki.rsa.generateKeyPair(1024)
  const certificato = forge.pki.createCertificate()
  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '01'
  certificato.validity.notBefore = new Date(Date.now() - 60_000)
  certificato.validity.notAfter = new Date(Date.now() + 86_400_000)
  const attributi = [{ name: 'commonName', value: 'firmatario-test' }]
  certificato.setSubject(attributi)
  certificato.setIssuer(attributi)
  certificato.sign(coppia.privateKey, forge.md.sha256.create())
  const certificatoBase64 = forge.util.encode64(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificato)).getBytes()
  )

  const riferimentiXml = firma.copre
    .map((bersaglio) => {
      const contenuto = contenuti.get(bersaglio) ?? ''
      const digest = firma.digestErrato
        ? forge.util.encode64('digest-deliberatamente-errato-per-test')
        : forge.util.encode64(
            forge.md.sha256.create().update(contenuto, 'utf8').digest().getBytes()
          )
      return `<ds:Reference URI="${bersaglio}"><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>`
    })
    .join('')

  const signedInfo = `<ds:SignedInfo>${riferimentiXml}</ds:SignedInfo>`

  const md = forge.md.sha256.create()
  md.update(signedInfo, 'utf8')
  const firmaBytes = coppia.privateKey.sign(md)
  let signatureValue = forge.util.encode64(firmaBytes)

  if (firma.firmaCorrotta) {
    // Decodifica, altera l'ultimo byte, ricodifica: invalida la firma senza
    // toccare i DigestValue, cosi' il test isola davvero la verifica
    // crittografica dalla verifica del digest.
    const bytes = forge.util.decode64(signatureValue)
    const ultimo = bytes.charCodeAt(bytes.length - 1) ^ 0xff
    const alterato = bytes.slice(0, -1) + String.fromCharCode(ultimo)
    signatureValue = forge.util.encode64(alterato)
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<asic:XAdESSignatures xmlns:asic="http://uri.etsi.org/02918/v1.2.1#" ' +
    'xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
    `<ds:Signature>${signedInfo}` +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Certificate>${certificatoBase64}</ds:X509Certificate></ds:KeyInfo>` +
    '</ds:Signature>' +
    '</asic:XAdESSignatures>'
  )
}
