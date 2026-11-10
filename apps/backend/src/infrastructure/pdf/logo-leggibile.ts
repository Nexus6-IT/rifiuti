import { creaStampantePdf } from './pdf.service'

/**
 * Prova che il logo si possa DAVVERO incorporare in un PDF (4.7, revisione I1): i magic bytes
 * giusti non bastano, un PNG troncato o con il corpo corrotto fa lanciare il motore al momento di
 * disegnare. `dataUrl` e' quello prodotto da `esaminaLogo`.
 */
export function logoLeggibile(dataUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
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
