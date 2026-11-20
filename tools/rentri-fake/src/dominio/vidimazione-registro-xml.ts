import { createHash } from 'crypto'

/** Dati dell'eREGI (`reg:VidimazioneRegistro` di `rentri-registri-1.0.xsd`). */
export interface DatiEregi {
  identificativo: string
  operatore: { numIscr: string; codiceFiscale: string; denominazione: string }
  numIscrSito: string
  indirizzoSito: string
  dataRichiesta: string
  identificativoRichiesta: string
  autoreRichiesta: string
  cciaaNome: string
}

export interface FirmaEregi {
  /** Firma RSA-SHA256 (base64) dei byte di `SignedInfo`. */
  firma: (signedInfo: string) => string
  certificatoBase64Der: string
}

const NS_REG = 'urn:it:rentri:registri:1.0'
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
export const ID_EREGI = 'eREGI-CS-0'

function esc(testo: string): string {
  return testo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function corpo(d: DatiEregi): string {
  return (
    `<reg:Identificativo>${esc(d.identificativo)}</reg:Identificativo>` +
    `<reg:Operatore><reg:NumIscr>${esc(d.operatore.numIscr)}</reg:NumIscr>` +
    `<reg:CodiceFiscale>${esc(d.operatore.codiceFiscale)}</reg:CodiceFiscale>` +
    `<reg:Denominazione>${esc(d.operatore.denominazione)}</reg:Denominazione></reg:Operatore>` +
    `<reg:NumIscrSito>${esc(d.numIscrSito)}</reg:NumIscrSito>` +
    `<reg:IndirizzoSito>${esc(d.indirizzoSito)}</reg:IndirizzoSito>` +
    `<reg:DataRichiesta>${esc(d.dataRichiesta)}</reg:DataRichiesta>` +
    `<reg:IdentificativoRichiesta>${esc(d.identificativoRichiesta)}</reg:IdentificativoRichiesta>` +
    `<reg:AutoreRichiesta>${esc(d.autoreRichiesta)}</reg:AutoreRichiesta>` +
    `<reg:CCIAANome>${esc(d.cciaaNome)}</reg:CCIAANome>`
  )
}

function apertura(): string {
  return `<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="${ID_EREGI}">`
}

/**
 * eREGI di prova: la vidimazione virtuale che `GET /operatore/registri/{id}/xml`
 * restituisce (in base64) col `ds:Signature` dell'ente e
 * `Reference URI="#eREGI-CS-0"`. La struttura segue `rentri-registri-1.0.xsd`
 * (`VidimazioneRegistro`).
 *
 * DIVERGENZE dichiarate (FEDELTA.md §9):
 * - `DigestValue` e' lo SHA-256 dell'eREGI serializzato SENZA `ds:Signature`
 *   cosi' come scritto qui, non della sua forma canonica C14N: il valore e' stabile
 *   e verificabile solo da chi ricalcola la stessa serializzazione;
 * - `SignatureValue` e' una firma RSA vera, ma sui byte di `SignedInfo` non
 *   canonicalizzati e con la chiave della credenziale di test, non con quella
 *   della CA RENTRI;
 * - `num_iscr_sito` delle fixture non rispetta il pattern `NumIscrSito` dell'XSD
 *   (`OP…-XX0000`): l'eREGI riporta il valore della fixture.
 */
export function costruisciEregi(dati: DatiEregi, firmatore: FirmaEregi): string {
  const senzaFirma = `${apertura()}${corpo(dati)}</reg:eREGI>`
  const digest = createHash('sha256').update(senzaFirma, 'utf8').digest('base64')

  const signedInfo =
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
    `<ds:Reference URI="#${ID_EREGI}"><ds:Transforms>` +
    `<ds:Transform Algorithm="${NS_DS}enveloped-signature"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
    `<ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`

  const firma =
    `<ds:Signature>${signedInfo}` +
    `<ds:SignatureValue>${firmatore.firma(signedInfo)}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${firmatore.certificatoBase64Der}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `</ds:Signature>`

  return `<?xml version="1.0" encoding="UTF-8"?>${apertura()}${corpo(dati)}${firma}</reg:eREGI>`
}
