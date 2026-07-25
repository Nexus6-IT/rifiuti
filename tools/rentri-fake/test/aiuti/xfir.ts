import JSZip from 'jszip'

/**
 * Costruisce un container ASiC-E minimo ma strutturalmente corretto, con
 * firme XAdES detached i cui Reference puntano ai file indicati in `copre`.
 * Serve a produrre sia container validi sia container deliberatamente
 * scorretti (firme che non coprono tutto).
 */
export async function creaContainerXfir(opzioni: {
  xml: string[]
  firme: { nomeFile: string; copre: string[] }[]
  conMimetype?: boolean
}): Promise<Buffer> {
  const zip = new JSZip()

  if (opzioni.conMimetype !== false) {
    zip.file('mimetype', 'application/vnd.etsi.asic-e+zip')
  }

  for (const nome of opzioni.xml) {
    zip.file(nome, `<?xml version="1.0" encoding="UTF-8"?><documento nome="${nome}"/>`)
  }

  for (const firma of opzioni.firme) {
    const riferimenti = firma.copre
      .map((bersaglio) => `<ds:Reference URI="${bersaglio}"><ds:DigestValue>x</ds:DigestValue></ds:Reference>`)
      .join('')

    const xmlFirma =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<asic:XAdESSignatures xmlns:asic="http://uri.etsi.org/02918/v1.2.1#" ' +
      'xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
      `<ds:Signature><ds:SignedInfo>${riferimenti}</ds:SignedInfo></ds:Signature>` +
      '</asic:XAdESSignatures>'

    zip.file(`META-INF/${firma.nomeFile}`, xmlFirma)
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}
