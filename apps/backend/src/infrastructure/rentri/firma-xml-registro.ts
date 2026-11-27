import * as crypto from 'crypto'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import type { SignatureAlgorithm } from 'xml-crypto'
import { algoritmoDaChiave } from './certificato/algoritmo-da-chiave'

/**
 * Firma XMLDSig *enveloped* del `reg:Registro` (eREGI E5), modalita' "R" di WinWaste
 * (`docs/rentri/01-autenticazione-e-firma.md` §3.1): `Reference URI=""` su tutto il documento,
 * transform enveloped-signature, C14N 1.0 senza commenti, digest SHA-256, `KeyInfo/X509Data`.
 * L'algoritmo di firma e' ricavato dalla chiave (RSA -> rsa-sha256, EC P-256 -> ecdsa-sha256,
 * firma P1363 r||s come vuole XMLDSig), MAI scelto da chi chiama.
 *
 * L'XML in ingresso non viene ri-serializzato: la firma e' calcolata sul documento parsato e poi
 * inserita come ultimo figlio della radice per concatenazione di stringhe, cosi' l'eREGI
 * dell'ente (firmato da RENTRI) resta identico byte per byte.
 *
 * SICUREZZA: nessuna funzione di questo modulo scrive log; i messaggi di errore non contengono mai
 * chiave, PEM o contenuto dell'XML.
 */
const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const ALG_ECDSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const ALG_DIGEST_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
const NS_REGISTRI = 'urn:it:rentri:registri:1.0'
const ID_FIRMA = 'FirmaRegistro'
const CHIUSURA_RADICE = '</reg:Registro>'

/** Tetto di lunghezza (caratteri): contro l'input patologico, non un limite di dominio (il limite RENTRI e' 10 MB). */
const LUNGHEZZA_MASSIMA_XML = 16 * 1024 * 1024

/** La firma non e' possibile o la verifica non e' eseguibile. Il messaggio non riporta mai materiale sensibile. */
export class FirmaXmlRegistroError extends Error {
  constructor(motivo: string) {
    super(`Firma XML del registro: ${motivo}`)
    this.name = 'FirmaXmlRegistroError'
  }
}

export interface MaterialeFirmaRegistro {
  /** Certificato X.509 del firmatario (PEM). */
  certificatePem: string
  /** Chiave privata (PEM): RSA oppure EC P-256. L'algoritmo si ricava da qui. */
  privateKeyPem: string
}

export interface XmlRegistroFirmato {
  xml: string
  /** `DigestValue` (base64) del `Reference URI=""`: e' il `Ref` che le esportazioni successive citeranno. */
  digestValue: string
}

/** ecdsa-sha256 per xml-crypto: firma IEEE P1363 (r||s), non il DER di default di Node. */
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
    // P-256: r||s = 64 byte esatti. Una lunghezza diversa non e' una firma XMLDSig valida.
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

function controllaXml(xml: unknown): asserts xml is string {
  if (typeof xml !== 'string' || xml.length === 0) {
    throw new FirmaXmlRegistroError("l'XML deve essere un testo non vuoto")
  }
  if (xml.length > LUNGHEZZA_MASSIMA_XML) throw new FirmaXmlRegistroError('XML troppo grande')
  // XXE e DTD: rifiutati sul testo, prima del parser.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new FirmaXmlRegistroError("l'XML non puo' contenere un DOCTYPE")
  }
}

type DocumentoXml = ReturnType<DOMParser['parseFromString']>

function parsa(xml: string): DocumentoXml {
  try {
    const documento = new DOMParser({
      onError: livello => {
        if (livello !== 'warning') throw new Error('xml')
      },
    }).parseFromString(xml, 'text/xml')
    if (!documento.documentElement) throw new Error('xml')
    return documento
  } catch {
    throw new FirmaXmlRegistroError('XML non ben formato')
  }
}

function figliElemento(padre: Element): Element[] {
  const risultato: Element[] = []
  for (let n = padre.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) risultato.push(n as Element)
  }
  return risultato
}

function radiceRegistro(documento: DocumentoXml): Element {
  const radice = documento.documentElement as unknown as Element
  if (radice.localName !== 'Registro' || radice.namespaceURI !== NS_REGISTRI) {
    throw new FirmaXmlRegistroError("la radice non e' reg:Registro")
  }
  return radice
}

function firmeDiRadice(radice: Element): Element[] {
  return figliElemento(radice).filter(e => e.localName === 'Signature' && e.namespaceURI === NS_DS)
}

/** Verifica che certificato e chiave privata siano una coppia (senza mai riportarne il contenuto). */
function leggiMateriale(materiale: MaterialeFirmaRegistro): {
  chiave: crypto.KeyObject
  certificatoBase64: string
  algoritmoXml: string
} {
  let algoritmo: 'RS256' | 'ES256'
  try {
    algoritmo = algoritmoDaChiave(materiale.privateKeyPem)
  } catch {
    throw new FirmaXmlRegistroError('tipo di chiave non supportato (servono RSA o EC P-256)')
  }
  let chiave: crypto.KeyObject
  let certificato: crypto.X509Certificate
  try {
    chiave = crypto.createPrivateKey(materiale.privateKeyPem)
    certificato = new crypto.X509Certificate(materiale.certificatePem)
  } catch {
    throw new FirmaXmlRegistroError('certificato o chiave illeggibili')
  }
  if (!certificato.checkPrivateKey(chiave)) {
    throw new FirmaXmlRegistroError('il certificato non corrisponde alla chiave privata')
  }
  return {
    chiave,
    certificatoBase64: certificato.raw.toString('base64'),
    algoritmoXml: algoritmo === 'ES256' ? ALG_ECDSA_SHA256 : ALG_RSA_SHA256,
  }
}

/**
 * Firma `xml` (un `reg:Registro` non firmato) e restituisce l'XML con la `ds:Signature` come ultimo
 * figlio della radice, piu' il `DigestValue` del documento. Rifiuta un registro che ha gia' una firma
 * di radice (si firmerebbe due volte) o che non e' un `reg:Registro`.
 */
export function firmaXmlRegistro(
  xml: string,
  materiale: MaterialeFirmaRegistro
): XmlRegistroFirmato {
  controllaXml(xml)
  const radice = radiceRegistro(parsa(xml))
  if (firmeDiRadice(radice).length > 0) {
    throw new FirmaXmlRegistroError('il registro e gia firmato')
  }
  if (!xml.trimEnd().endsWith(CHIUSURA_RADICE)) {
    throw new FirmaXmlRegistroError('la radice deve essere scritta con il prefisso reg:')
  }

  const { chiave, certificatoBase64, algoritmoXml } = leggiMateriale(materiale)

  try {
    const firmatore = new SignedXml({
      privateKey: chiave.export({ type: 'pkcs8', format: 'pem' }) as string,
      signatureAlgorithm: algoritmoXml,
      canonicalizationAlgorithm: ALG_C14N,
      getKeyInfoContent: () =>
        `<ds:X509Data><ds:X509Certificate>${certificatoBase64}</ds:X509Certificate></ds:X509Data>`,
    })
    firmatore.SignatureAlgorithms[ALG_ECDSA_SHA256] = EcdsaSha256
    firmatore.addReference({
      xpath: '/*',
      isEmptyUri: true,
      transforms: [ALG_ENVELOPED, ALG_C14N],
      digestAlgorithm: ALG_DIGEST_SHA256,
    })
    firmatore.computeSignature(xml, {
      prefix: 'ds',
      attrs: { Id: ID_FIRMA },
      location: { reference: '/*', action: 'append' },
    })

    const firma = firmatore.getSignatureXml()
    const digestValue = /<(?:ds:)?DigestValue>([A-Za-z0-9+/=]+)<\/(?:ds:)?DigestValue>/.exec(
      firma
    )?.[1]
    if (!digestValue) throw new Error('digest assente')

    const corpo = xml.trimEnd()
    const firmato = corpo.slice(0, corpo.length - CHIUSURA_RADICE.length) + firma + CHIUSURA_RADICE
    return { xml: firmato, digestValue }
  } catch (e) {
    if (e instanceof FirmaXmlRegistroError) throw e
    // Messaggio generico: l'errore di xml-crypto puo' citare frammenti del documento o della chiave.
    throw new FirmaXmlRegistroError('calcolo della firma non riuscito')
  }
}

export type EsitoVerificaFirma =
  | { valida: true; digestValue: string; algoritmo: string }
  | { valida: false; motivo: string }

/**
 * Verifica la firma di radice di un `reg:Registro` con il certificato contenuto nel `KeyInfo`
 * (coerenza interna: nessuna catena di fiducia, come `validatore-xades.ts` della fake). Accetta solo
 * un documento con ESATTAMENTE una firma di radice, un solo `Reference` con `URI=""`, transform
 * enveloped, C14N 1.0 e SHA-256: tutto il resto e' una firma che non copre il documento.
 * Non lancia: ogni problema e' un `valida: false` con motivo generico.
 */
export function verificaFirmaXmlRegistro(xml: string): EsitoVerificaFirma {
  try {
    controllaXml(xml)
    const radice = radiceRegistro(parsa(xml))
    const firme = firmeDiRadice(radice)
    if (firme.length === 0) return { valida: false, motivo: 'firma assente' }
    if (firme.length > 1) return { valida: false, motivo: 'piu di una firma di radice' }
    const firma = firme[0]

    const algoritmo = trovaAttributo(firma, 'SignatureMethod', 'Algorithm')
    if (algoritmo !== ALG_RSA_SHA256 && algoritmo !== ALG_ECDSA_SHA256) {
      return { valida: false, motivo: 'algoritmo di firma non ammesso' }
    }
    const riferimenti = elementiDiscendenti(firma, 'Reference')
    if (riferimenti.length !== 1 || riferimenti[0].getAttribute('URI') !== '') {
      return { valida: false, motivo: 'la firma non copre tutto il documento' }
    }
    if (
      trovaAttributo(firma, 'CanonicalizationMethod', 'Algorithm') !== ALG_C14N ||
      trovaAttributo(riferimenti[0], 'DigestMethod', 'Algorithm') !== ALG_DIGEST_SHA256
    ) {
      return { valida: false, motivo: 'canonicalizzazione o digest non ammessi' }
    }
    const trasformazioni = elementiDiscendenti(riferimenti[0], 'Transform').map(t =>
      t.getAttribute('Algorithm')
    )
    if (!trasformazioni.includes(ALG_ENVELOPED)) {
      return { valida: false, motivo: 'manca il transform enveloped-signature' }
    }
    const certificatoBase64 = elementiDiscendenti(firma, 'X509Certificate')[0]?.textContent
    if (!certificatoBase64) return { valida: false, motivo: 'certificato assente' }
    const digestValue = elementiDiscendenti(riferimenti[0], 'DigestValue')[0]?.textContent?.trim()
    if (!digestValue) return { valida: false, motivo: 'digest assente' }

    const certificatoPem = new crypto.X509Certificate(
      Buffer.from(certificatoBase64.replace(/\s+/g, ''), 'base64')
    ).publicKey.export({ type: 'spki', format: 'pem' }) as string

    const verificatore = new SignedXml({ publicCert: certificatoPem })
    verificatore.SignatureAlgorithms = {
      [ALG_RSA_SHA256]: verificatore.SignatureAlgorithms[ALG_RSA_SHA256],
      [ALG_ECDSA_SHA256]: EcdsaSha256,
    }
    verificatore.loadSignature(firma as unknown as Node)
    const ok = verificatore.checkSignature(xml)
    return ok
      ? { valida: true, digestValue, algoritmo }
      : { valida: false, motivo: 'firma non valida' }
  } catch {
    return { valida: false, motivo: 'firma non verificabile' }
  }
}

function elementiDiscendenti(padre: Element, nomeLocale: string): Element[] {
  return Array.from(padre.getElementsByTagNameNS(NS_DS, nomeLocale)) as Element[]
}

function trovaAttributo(padre: Element, nomeLocale: string, attributo: string): string | null {
  return elementiDiscendenti(padre, nomeLocale)[0]?.getAttribute(attributo) ?? null
}
