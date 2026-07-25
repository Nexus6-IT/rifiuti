import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'
import forge from 'node-forge'

export interface RiferimentoXades {
  uri: string
  digestValue: string
}

export interface FirmaXades {
  nomeFile: string
  /** Solo gli URI referenziati: retrocompatibile con verificaCopertura. */
  riferimenti: string[]
  riferimentiConDigest: RiferimentoXades[]
  /**
   * Sottostringa grezza `<ds:SignedInfo>...</ds:SignedInfo>` cosi' come
   * appare nel documento sorgente. Usata per verificare `SignatureValue`:
   * non e' una canonicalizzazione XML C14N conforme allo standard
   * XAdES/ETSI EN 319 132 (fuori scopo per una fake), ma una firma RSA reale
   * sui byte di questa sottostringa, sufficiente a rilevare manomissioni del
   * contenuto firmato o della firma stessa.
   */
  signedInfoRaw: string
  signatureValue?: string
  certificatoBase64?: string
}

const NS = {
  ds: 'http://www.w3.org/2000/09/xmldsig#',
}

function testoNodo(nodo: Node | undefined | null): string | undefined {
  return nodo?.textContent?.trim() || undefined
}

/**
 * Estrae da una firma XAdES detached i riferimenti (URI + DigestValue), il
 * blocco SignedInfo grezzo, e SignatureValue/certificato dal KeyInfo.
 */
export function estraiRiferimenti(nomeFile: string, xml: string): FirmaXades {
  const documento = new DOMParser().parseFromString(xml, 'text/xml')
  const seleziona = xpath.useNamespaces(NS)

  const nodiRiferimento = seleziona('//ds:Reference', documento as unknown as Node) as Element[]
  const riferimentiConDigest: RiferimentoXades[] = nodiRiferimento.map((nodo) => {
    const uri = nodo.getAttribute('URI') ?? ''
    const digestNodi = seleziona('.//ds:DigestValue', nodo as unknown as Node) as Node[]
    return { uri, digestValue: testoNodo(digestNodi[0]) ?? '' }
  })

  const signatureValueNodi = seleziona('//ds:SignatureValue', documento as unknown as Node) as Node[]
  const certNodi = seleziona('//ds:X509Certificate', documento as unknown as Node) as Node[]

  return {
    nomeFile,
    riferimenti: riferimentiConDigest.map((r) => r.uri),
    riferimentiConDigest,
    signedInfoRaw: estraiSottostringaSignedInfo(xml),
    signatureValue: testoNodo(signatureValueNodi[0])?.replace(/\s+/g, ''),
    certificatoBase64: testoNodo(certNodi[0])?.replace(/\s+/g, ''),
  }
}

function estraiSottostringaSignedInfo(xml: string): string {
  const inizio = xml.indexOf('<ds:SignedInfo')
  const fine = xml.indexOf('</ds:SignedInfo>')
  if (inizio === -1 || fine === -1) {
    return ''
  }
  return xml.slice(inizio, fine + '</ds:SignedInfo>'.length)
}

export type EsitoRegola = { valido: true } | { valido: false; motivo: string }

/**
 * Regola di copertura RENTRI, verificata in ENTRAMBI i versi
 * (FEDELTA.md §5.2 punto 5, correzione di §3.5):
 * - ogni XML presente nel container deve essere coperto da ciascuna firma
 *   (come prima: una firma che ne salta uno rende l'xFIR invalido);
 * - NESSUN Reference puo' puntare a un file assente dal container (un
 *   "riferimento pendente" non e' risolvibile: la fake precedente lo
 *   accettava come valido);
 * - un container senza alcun XML presente e' invalido a prescindere da cosa
 *   dichiarino le firme: la copertura non puo' essere vacuamente
 *   soddisfatta da un container privo del documento firmato.
 */
export function verificaCopertura(firme: FirmaXades[], xmlPresenti: string[]): EsitoRegola {
  if (xmlPresenti.length === 0) {
    return { valido: false, motivo: 'nessun documento XML presente nel container: copertura vacua' }
  }

  for (const firma of firme) {
    const mancanti = xmlPresenti.filter((xml) => !firma.riferimenti.includes(xml))
    if (mancanti.length > 0) {
      return {
        valido: false,
        motivo: `la firma ${firma.nomeFile} non copre: ${mancanti.join(', ')}`,
      }
    }

    const pendenti = firma.riferimenti.filter((rif) => !xmlPresenti.includes(rif))
    if (pendenti.length > 0) {
      return {
        valido: false,
        motivo: `la firma ${firma.nomeFile} referenzia file assenti dal container (riferimento pendente): ${pendenti.join(', ')}`,
      }
    }
  }

  return { valido: true }
}

/**
 * Verifica il `DigestValue` di ogni Reference rispetto al contenuto
 * effettivamente presente nel container (FEDELTA.md §5.2 punto 6): prima di
 * questa correzione il digest non era mai confrontato con nulla.
 */
export function verificaDigest(firma: FirmaXades, contenuti: Map<string, Buffer>): EsitoRegola {
  for (const rif of firma.riferimentiConDigest) {
    const contenuto = contenuti.get(rif.uri)
    if (!contenuto) {
      // Un riferimento a un file assente e' gia' rifiutato da
      // verificaCopertura: qui ci limitiamo ai file effettivamente presenti.
      continue
    }

    const digestCalcolato = forge.util.encode64(
      forge.md.sha256.create().update(contenuto.toString('utf8'), 'utf8').digest().getBytes()
    )

    if (digestCalcolato !== rif.digestValue) {
      return {
        valido: false,
        motivo: `DigestValue non corrispondente per '${rif.uri}' nella firma ${firma.nomeFile}: il contenuto referenziato non e' quello firmato`,
      }
    }
  }

  return { valido: true }
}

/**
 * Verifica la validita' crittografica di `SignatureValue` rispetto al
 * `SignedInfo` e al certificato del firmatario dichiarati nella firma
 * stessa (FEDELTA.md §5.2 punto 6): prima di questa correzione nessun byte
 * doveva essere realmente firmato perche' l'xFIR risultasse "valido".
 */
export function verificaFirmaCrittografica(firma: FirmaXades): EsitoRegola {
  if (!firma.signatureValue || !firma.certificatoBase64) {
    return {
      valido: false,
      motivo: `firma ${firma.nomeFile}: SignatureValue o certificato (KeyInfo/X509Certificate) assente`,
    }
  }

  try {
    const pem = `-----BEGIN CERTIFICATE-----\n${firma.certificatoBase64}\n-----END CERTIFICATE-----`
    const certificato = forge.pki.certificateFromPem(pem)
    const chiavePubblica = certificato.publicKey as forge.pki.rsa.PublicKey

    const md = forge.md.sha256.create()
    md.update(firma.signedInfoRaw, 'utf8')
    const firmaBytes = forge.util.decode64(firma.signatureValue)

    const valida = chiavePubblica.verify(md.digest().bytes(), firmaBytes)
    if (!valida) {
      return { valido: false, motivo: `firma ${firma.nomeFile}: verifica crittografica fallita` }
    }

    return { valido: true }
  } catch (errore) {
    return {
      valido: false,
      motivo: `firma ${firma.nomeFile}: errore nella verifica crittografica (${(errore as Error).message})`,
    }
  }
}
