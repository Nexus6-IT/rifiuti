import * as crypto from 'crypto'
import { DOMParser } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { SignedXml } from 'xml-crypto'
import type { SignatureAlgorithm } from 'xml-crypto'

/**
 * Verifica, per `POST .../valida`, della firma XMLDSig enveloped di un `reg:Registro` e della catena
 * dei digest (eREGI E5). COERENZA INTERNA, come `xfir/validatore-xades.ts`: la firma si verifica con
 * il certificato che il documento stesso porta nel `KeyInfo`, senza alcuna catena di fiducia verso una
 * CA (FEDELTA.md). Se il file non e' un `reg:Registro` (o non e' XML) non si dice nulla: la validazione
 * XSD vera resta decisione del canale di controllo.
 *
 * Messaggi (`EsitoMessaggioModel`): `firmaNonPresente` (Avvertimento), `firmaNonValida` e
 * `catenaDigestNonValida` (Errore).
 */
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const NS_REG = 'urn:it:rentri:registri:1.0'
const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const ALG_ECDSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ALG_ENVELOPED = `${NS_DS}enveloped-signature`
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const ID_EREGI = '#eREGI-CS-0'

export interface MessaggioFirmaRegistro {
  tipo: 'Errore' | 'Avvertimento'
  codice_messaggio: string
}

/** ecdsa-sha256 in formato IEEE P1363 (r||s), come vuole XMLDSig. */
class EcdsaSha256 implements SignatureAlgorithm {
  getSignature(signedInfo: crypto.BinaryLike, privateKey: crypto.KeyLike): string {
    return crypto
      .sign('sha256', Buffer.from(signedInfo as string), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      } as crypto.SignKeyObjectInput)
      .toString('base64')
  }

  verifySignature(material: string, key: crypto.KeyLike, signatureValue: string): boolean {
    const firma = Buffer.from(signatureValue, 'base64')
    if (firma.length !== 64) return false
    return crypto.verify(
      'sha256',
      Buffer.from(material),
      { key, dsaEncoding: 'ieee-p1363' } as crypto.VerifyKeyObjectInput,
      firma
    )
  }

  getAlgorithmName(): string {
    return ALG_ECDSA_SHA256
  }
}

/** Estrae l'XML dal `file_content` (base64 di un .xml, o di uno .zip con un solo XML). */
export async function estraiXmlDaFile(
  fileContent: string,
  nomeFile: string
): Promise<string | undefined> {
  try {
    const buffer = Buffer.from(fileContent, 'base64')
    if (nomeFile.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(buffer)
      const voci = Object.values(zip.files).filter(
        f => !f.dir && f.name.toLowerCase().endsWith('.xml')
      )
      return voci.length === 1 ? await voci[0].async('string') : undefined
    }
    return buffer.toString('utf8')
  } catch {
    return undefined
  }
}

type Elemento = NonNullable<
  ReturnType<InstanceType<typeof DOMParser>['parseFromString']>['documentElement']
>

function figli(padre: Elemento, nomeLocale: string, ns: string): Elemento[] {
  const risultato: Elemento[] = []
  for (let n = padre.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.localName === nomeLocale && n.namespaceURI === ns) {
      risultato.push(n as Elemento)
    }
  }
  return risultato
}

function discendenti(padre: Elemento, nomeLocale: string): Elemento[] {
  return Array.from(padre.getElementsByTagNameNS(NS_DS, nomeLocale)) as Elemento[]
}

function verificaFirma(xml: string, firma: Elemento): boolean {
  try {
    const algoritmo = discendenti(firma, 'SignatureMethod')[0]?.getAttribute('Algorithm')
    if (algoritmo !== ALG_RSA_SHA256 && algoritmo !== ALG_ECDSA_SHA256) return false
    const riferimenti = discendenti(firma, 'Reference')
    // Deve coprire tutto il documento (URI="") con enveloped + C14N 1.0 + SHA-256.
    if (riferimenti.length !== 1 || riferimenti[0].getAttribute('URI') !== '') return false
    const trasformazioni = discendenti(riferimenti[0], 'Transform').map(t =>
      t.getAttribute('Algorithm')
    )
    if (!trasformazioni.includes(ALG_ENVELOPED)) return false
    if (discendenti(riferimenti[0], 'DigestMethod')[0]?.getAttribute('Algorithm') !== ALG_SHA256)
      return false
    if (discendenti(firma, 'CanonicalizationMethod')[0]?.getAttribute('Algorithm') !== ALG_C14N)
      return false

    const certificato = discendenti(firma, 'X509Certificate')[0]?.textContent?.replace(/\s+/g, '')
    if (!certificato) return false
    const chiavePubblica = new crypto.X509Certificate(
      Buffer.from(certificato, 'base64')
    ).publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string

    const verificatore = new SignedXml({ publicCert: chiavePubblica })
    verificatore.SignatureAlgorithms = {
      [ALG_RSA_SHA256]: verificatore.SignatureAlgorithms[ALG_RSA_SHA256],
      [ALG_ECDSA_SHA256]: EcdsaSha256,
    }
    verificatore.loadSignature(firma as never)
    return verificatore.checkSignature(xml)
  } catch {
    return false
  }
}

/**
 * Controlla firma e catena. Ritorna `undefined` se `xml` non e' un `reg:Registro` ben formato (nessun
 * giudizio), altrimenti l'elenco dei messaggi (vuoto se tutto torna).
 */
export function controllaFirmaERegistro(xml: string): MessaggioFirmaRegistro[] | undefined {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return undefined
  let radice: Elemento | null
  try {
    radice = new DOMParser({
      onError: l => {
        if (l !== 'warning') throw new Error('xml')
      },
    }).parseFromString(xml, 'text/xml').documentElement
  } catch {
    return undefined
  }
  if (!radice || radice.localName !== 'Registro' || radice.namespaceURI !== NS_REG) return undefined

  const messaggi: MessaggioFirmaRegistro[] = []

  const firme = figli(radice, 'Signature', NS_DS)
  if (firme.length === 0) {
    messaggi.push({ tipo: 'Avvertimento', codice_messaggio: 'firmaNonPresente' })
  } else if (firme.length > 1 || !verificaFirma(xml, firme[0])) {
    messaggi.push({ tipo: 'Errore', codice_messaggio: 'firmaNonValida' })
  }

  // Catena: Ref[0] = digest del Reference dell'eREGI rilasciato dall'ente (che sta nel documento).
  const riferimenti = figli(radice, 'RiferimentiPrecedenti', NS_REG)[0]
  const ref0 = riferimenti ? figli(riferimenti, 'Ref', NS_REG)[0] : undefined
  if (ref0) {
    const eregi = figli(radice, 'eREGI', NS_REG)[0]
    const firmaEregi = eregi ? figli(eregi, 'Signature', NS_DS)[0] : undefined
    const riferimentoEregi = firmaEregi
      ? discendenti(firmaEregi, 'Reference').find(r => r.getAttribute('URI') === ID_EREGI)
      : undefined
    const digestEregi = riferimentoEregi
      ? discendenti(riferimentoEregi, 'DigestValue')[0]?.textContent?.trim()
      : undefined
    if (!digestEregi || ref0.getAttribute('DigestValue') !== digestEregi) {
      messaggi.push({ tipo: 'Errore', codice_messaggio: 'catenaDigestNonValida' })
    }
  }

  return messaggi
}
