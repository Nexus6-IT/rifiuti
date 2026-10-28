import * as crypto from 'crypto'
import * as forge from 'node-forge'

/** Certificato + chiave privata estratti da un PKCS#12, in formato PEM. */
export interface Pkcs12Pem {
  certificatePem: string
  privateKeyPem: string
  /** Tipo della chiave privata (ricavato da Node crypto, non da node-forge). */
  tipoChiave: 'rsa' | 'ec'
  /** Solo per le chiavi EC: nome OpenSSL della curva, es. 'prime256v1'. */
  curva?: string
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
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBagList = certBags[forge.pki.oids.certBag] || []

  // 3a. Chiave privata. RSA: node-forge la converte (PEM PKCS#1, formato invariato).
  // EC: node-forge apre il contenitore (MAC e decifratura) ma non sa convertire le
  // chiavi EC, quindi lascia nel bag solo l'ASN.1 (campo asn1 del bag): lo si
  // serializza in DER e lo si passa a Node crypto (PKCS#8).
  let chiave: crypto.KeyObject | undefined
  let privateKeyPem: string | undefined
  const chiaveRsa = keyBagList.find(bag => bag.key)?.key
  if (chiaveRsa) {
    privateKeyPem = forge.pki.privateKeyToPem(chiaveRsa)
    chiave = crypto.createPrivateKey(privateKeyPem)
  } else {
    for (const bag of keyBagList) {
      if (!bag.asn1) continue
      try {
        const der = Buffer.from(forge.asn1.toDer(bag.asn1).getBytes(), 'binary')
        chiave = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
        privateKeyPem = chiave.export({ type: 'pkcs8', format: 'pem' }).toString()
        break
      } catch {
        // bag non convertibile: si prova il successivo (nessun dettaglio nel messaggio)
      }
    }
  }
  if (!chiave || !privateKeyPem) {
    throw new Error('PKCS#12 privo di chiave privata')
  }

  // Il tipo si ricava dalla chiave (Node crypto), non e' fissato dal percorso.
  const tipo = chiave.asymmetricKeyType
  if (tipo !== 'rsa' && tipo !== 'ec') {
    throw new Error('PKCS#12 con tipo di chiave non supportato')
  }

  // Il certificato giusto è quello la cui chiave pubblica combacia con la privata:
  // il .p12 di solito allega anche la CA, che non va scambiata per la foglia.
  let certificatePem: string | undefined
  for (const bag of certBagList) {
    try {
      // Se node-forge ha gia' decodificato il certificato (RSA) si restituisce il suo
      // PEM, invariato; altrimenti (EC) si riparte dall'ASN.1 grezzo.
      const pemForge = bag.cert ? forge.pki.certificateToPem(bag.cert) : undefined
      const x509 = pemForge
        ? new crypto.X509Certificate(pemForge)
        : bag.asn1
          ? new crypto.X509Certificate(Buffer.from(forge.asn1.toDer(bag.asn1).getBytes(), 'binary'))
          : undefined
      if (x509?.checkPrivateKey(chiave)) {
        certificatePem = pemForge ?? x509.toString()
        break
      }
    } catch {
      // certificato non leggibile: si prova il successivo
    }
  }
  if (!certificatePem) {
    throw new Error('PKCS#12 privo di certificato')
  }

  return {
    certificatePem,
    privateKeyPem,
    tipoChiave: tipo,
    curva: tipo === 'ec' ? chiave.asymmetricKeyDetails?.namedCurve : undefined,
  }
}
