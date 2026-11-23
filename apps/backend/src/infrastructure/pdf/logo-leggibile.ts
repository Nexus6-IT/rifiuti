import { creaStampantePdf } from './pdf.service'
import { leggiPngSicuro } from './png-sicuro'

/**
 * Prova che il logo si possa DAVVERO incorporare in un PDF (4.7, revisione I1): i magic bytes
 * giusti non bastano, un PNG troncato o con il corpo corrotto fa lanciare il motore al momento di
 * disegnare. `dataUrl` e' quello prodotto da `esaminaLogo`.
 *
 * Un PNG si verifica PRIMA in modo sincrono (`png-sicuro`): il motore decodifica i pixel in una
 * callback asincrona di zlib e un IDAT corrotto o un filtro non valido lancerebbero li', fuori da
 * ogni try/catch (crash del processo). Un logo che non passa conta come illeggibile.
 */
export function logoLeggibile(dataUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const m = /^data:image\/png;base64,(.*)$/.exec(dataUrl)
      if (m && !leggiPngSicuro(Buffer.from(m[1], 'base64')).ok) {
        resolve(false)
        return
      }
      const doc = creaStampantePdf().createPdfKitDocument({
        content: [{ image: dataUrl, width: 10 }],
      })
      doc.on('data', () => undefined)
      doc.on('end', () => resolve(true))
      doc.on('error', () => resolve(false))
      doc.end()
    } catch {
      resolve(false)
    }
  })
}
