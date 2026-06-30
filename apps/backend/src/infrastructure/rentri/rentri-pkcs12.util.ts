import * as forge from 'node-forge'

/** Certificato + chiave privata estratti da un PKCS#12, in formato PEM. */
export interface Pkcs12Pem {
  certificatePem: string
  privateKeyPem: string
}

/**
 * Estrae certificato e chiave privata in PEM da un container PKCS#12 (.p12/.pfx).
 *
 * Il PKCS#12 può essere passato come Buffer (DER grezzo) oppure come stringa
 * base64. La `passphrase` protegge sia il "safe bag" della chiave sia il MAC del
 * file: una passphrase errata o un file non valido producono un errore con
 * messaggio chiaro.
 *
 * SICUREZZA: questa funzione NON logga mai chiave privata, certificato o
 * passphrase. In caso di errore restituisce solo un messaggio generico.
 */
export function parsePkcs12(base64OrBuffer: string | Buffer, passphrase: string): Pkcs12Pem {
  // 1. Normalizza l'input in DER binario (stringa "raw" attesa da node-forge).
  let derBinary: string
  try {
    const buffer = Buffer.isBuffer(base64OrBuffer)
      ? base64OrBuffer
      : Buffer.from(base64OrBuffer, 'base64')

    if (buffer.length === 0) {
      throw new Error('contenuto vuoto')
    }

    // node-forge lavora su stringhe binarie ("latin1"), non su Buffer.
    derBinary = buffer.toString('binary')
  } catch {
    throw new Error('PKCS#12 non valido: impossibile decodificare il contenuto (base64/DER)')
  }

  // 2. Parsifica l'ASN.1 e apri il PKCS#12 con la passphrase.
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const asn1 = forge.asn1.fromDer(derBinary)
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase)
  } catch {
    // node-forge usa lo stesso percorso per MAC verification e parsing: una
    // passphrase errata si manifesta tipicamente qui. Non distinguiamo i due
    // casi per non rivelare dettagli sul contenuto cifrato.
    throw new Error('PKCS#12 non leggibile: file non valido oppure passphrase errata')
  }

  // 3. Estrai la chiave privata (cerca tra i bag pkcs8Shrouded e keyBag).
  const keyBags = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }),
    ...p12.getBags({ bagType: forge.pki.oids.keyBag }),
  }
  const keyBagList = [
    ...(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(keyBags[forge.pki.oids.keyBag] || []),
  ]
  const privateKey = keyBagList.find(bag => bag.key)?.key
  if (!privateKey) {
    throw new Error('PKCS#12 privo di chiave privata')
  }

  // 4. Estrai il certificato (primo certBag disponibile).
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certificate = (certBags[forge.pki.oids.certBag] || []).find(bag => bag.cert)?.cert
  if (!certificate) {
    throw new Error('PKCS#12 privo di certificato')
  }

  // 5. Serializza in PEM.
  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
  }
}
