import { estraiRiferimenti } from '../src/xfir/validatore-xades'

const DS = 'http://www.w3.org/2000/09/xmldsig#'

describe('estraiRiferimenti: algoritmo di firma', () => {
  it('legge il SignatureMethod solo sotto ds:SignedInfo, ignorando quelli altrove', () => {
    // Un SignatureMethod "estraneo" compare PRIMA di SignedInfo (es. dentro un
    // Object/QualifyingProperties): non deve condizionare l'algoritmo dichiarato.
    const xml =
      `<ds:Signature xmlns:ds="${DS}">` +
      `<ds:Object><ds:SignatureMethod Algorithm="http://esempio/estraneo"/></ds:Object>` +
      `<ds:SignedInfo>` +
      `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>` +
      `<ds:Reference URI="doc.xml"><ds:DigestValue>AAAA</ds:DigestValue></ds:Reference>` +
      `</ds:SignedInfo>` +
      `<ds:SignatureValue>BBBB</ds:SignatureValue>` +
      `</ds:Signature>`

    const firma = estraiRiferimenti('firma.xml', xml)

    expect(firma.algoritmoFirma).toBe('http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')
  })
})
