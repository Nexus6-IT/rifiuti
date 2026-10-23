import JSZip from 'jszip'
import * as crypto from 'crypto'

/** Mimetype ASiC-E atteso (ETSI TS 102 918), verificato per uguaglianza esatta dal validatore del finto RENTRI. */
export const MIMETYPE_ASICE = 'application/vnd.etsi.asic-e+zip'

/** Un documento XML del formulario, alla radice del container (mai sotto `META-INF/`). */
export interface DocumentoAsicE {
  /** Nome del file dentro il container (es. 'formulario.xml'). */
  nome: string
  /** Contenuto XML testuale, UTF-8. */
  contenuto: string
}

/**
 * Materiale per la firma XAdES di TEST prodotta da questo modulo.
 *
 * **NESSUN VALORE LEGALE.** Questa firma non e' rilasciata da un certificatore
 * accreditato (QTSP) e non ha alcuna ancora di fiducia: e' una coppia
 * certificato/chiave autofirmata, verificabile solo internamente (digest +
 * `SignatureValue` coerenti fra loro). Il finto RENTRI (`validatore-xades.ts`)
 * verifica ESATTAMENTE questo — coerenza interna — mai la conformita' a ETSI
 * EN 319 132 ne' una catena di fiducia reale (dichiarato esplicitamente da
 * `docs/contracts/rentri/FEDELTA.md`). La via corretta in produzione e' la
 * firma REMOTA della CA RENTRI (v. `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`
 * e i metodi `richiediHashPerFirma`/`inviaAcquisizioneFirma` di
 * `RENTRIApiClient`): la chiave privata dell'operatore non deve MAI transitare
 * per questo modulo. `costruisciAsicE` esiste per costruire container di TEST
 * (verificabili contro il finto) e non deve essere invocato con materiale di
 * firma reale di un operatore.
 */
export interface MaterialeFirmaTest {
  /** Certificato X.509 in PEM (`-----BEGIN CERTIFICATE-----...`). */
  certificatoPem: string
  /** Chiave privata corrispondente, in PEM: RSA (rsa-sha256) oppure EC P-256 (ecdsa-sha256). */
  chiavePrivataPem: string
  /** Nome del file di firma in `META-INF/` (default `signatures.xml`). */
  nomeFileFirma?: string
}

export interface OpzioniCostruzioneAsicE {
  documenti: DocumentoAsicE[]
  firma: MaterialeFirmaTest
}

/**
 * Costruisce un container ASiC-E (ETSI TS 102 918) con gli XML del formulario
 * e una firma XAdES detached che li copre tutti.
 *
 * Vincoli davvero verificati dal finto RENTRI
 * (`tools/rentri-fake/src/xfir/validatore-asice.ts` +
 * `validatore-xades.ts`, letti prima di scrivere questo modulo — NON
 * assunti):
 * - `mimetype` presente, contenuto ESATTAMENTE uguale (dopo trim) a
 *   {@link MIMETYPE_ASICE} — un mimetype diverso o assente e' rifiutato;
 * - almeno un file `.xml` sotto `META-INF/` (la/le firma/e XAdES) — zero
 *   firme e' rifiutato;
 * - la copertura e' verificata in ENTRAMBI i versi: ogni XML presente alla
 *   radice deve comparire in un `ds:Reference` di OGNI firma, e nessun
 *   `ds:Reference` puo' puntare a un file assente dal container (nessun
 *   riferimento pendente); un container senza alcun XML alla radice e'
 *   comunque rifiutato (copertura vacua);
 * - ogni `ds:Reference/DigestValue` deve essere il SHA-256 (base64) reale del
 *   contenuto UTF-8 del file referenziato, cosi' come si trova nel container;
 * - `ds:SignatureValue` deve essere una firma reale (RSA PKCS#1 v1.5, oppure ECDSA in
 *   formato IEEE P1363 r||s) sul blocco
 *   `ds:SignedInfo` (la sua sottostringa grezza, non una canonicalizzazione
 *   C14N conforme XAdES — limite dichiarato dal finto stesso), verificabile
 *   con la chiave pubblica di `ds:KeyInfo/X509Certificate`.
 *
 * Convenzioni ASiC-E rispettate anche dove il finto non le verifica:
 * - `mimetype` e' il PRIMO file scritto nell'archivio e non compresso
 *   (`STORE`) — l'ordine di iterazione di JSZip rispecchia l'ordine di
 *   inserimento; il finto non lo controlla, ma un ente reale potrebbe;
 * - `META-INF/manifest.xml` con una voce per il contenitore e una per ogni
 *   documento (ETSI TS 102 918).
 *
 * NOTA DI STORIA, perche' non si ripeta. La prima stesura di questo modulo NON
 * produceva il manifest: il validatore del finto considerava firma XAdES ogni
 * `.xml` sotto `META-INF/`, quindi un manifest veniva letto come una firma
 * priva di riferimenti e faceva rifiutare qualunque contenitore. La scelta
 * apparentemente ragionevole — «non produco il manifest cosi' passa» —
 * significava pero' costruire un contenitore NON conforme per compiacere un
 * oracolo infedele: esattamente il danno che quello strumento esiste per
 * evitare. La correzione e' stata fatta dalla parte giusta, cioe' nel finto,
 * che ora riconosce come firme solo i file `META-INF/*signatures*.xml`
 * secondo la convenzione ASiC. Da cui il vincolo: il nome del file di firma
 * deve contenere «signatures».
 */
export async function costruisciAsicE(opzioni: OpzioniCostruzioneAsicE): Promise<Buffer> {
  if (opzioni.documenti.length === 0) {
    throw new Error(
      'costruisciAsicE richiede almeno un documento XML da includere nel container (copertura vacua altrimenti rifiutata dal validatore).'
    )
  }

  for (const documento of opzioni.documenti) {
    if (documento.nome.startsWith('META-INF/')) {
      throw new Error(
        `Nome file non valido per un documento dati: '${documento.nome}' e' riservato a META-INF/.`
      )
    }
  }

  const zip = new JSZip()

  // Primo file inserito, non compresso: convenzione ASiC-E (v. commento di
  // testata) — non verificata dal finto, ma un ente reale potrebbe pretenderla.
  zip.file('mimetype', MIMETYPE_ASICE, { compression: 'STORE' })

  for (const documento of opzioni.documenti) {
    zip.file(documento.nome, documento.contenuto)
  }

  // Manifest ASiC (ETSI TS 102 918): dichiara i file del contenitore e il
  // loro tipo. Il nome del file di firma DEVE contenere «signatures», perche'
  // e' quella la convenzione con cui un validatore distingue una firma dal
  // manifest — se non la rispetta, il manifest verrebbe letto come una firma
  // senza riferimenti e il contenitore rifiutato.
  zip.file('META-INF/manifest.xml', costruisciManifest(opzioni.documenti))

  const nomeFileFirma = opzioni.firma.nomeFileFirma ?? 'signatures.xml'
  zip.file(`META-INF/${nomeFileFirma}`, costruisciFirmaXades(opzioni.documenti, opzioni.firma))

  return zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * Firma XAdES detached di TEST — v. {@link MaterialeFirmaTest} per i limiti
 * (nessun valore legale). Digest e firma sono calcolati con le STESSE
 * primitive che il validatore usera' per riverificarli
 * (`validatore-xades.ts`: SHA-256 su stringa UTF-8 per il digest, firma
 * SHA-256 sulla sottostringa grezza di `ds:SignedInfo` per `SignatureValue`) — non e'
 * un dettaglio incidentale: qualunque scarto (es. canonicalizzazione XML)
 * produrrebbe una firma che il finto rifiuta.
 *
 * L'algoritmo si ricava dal tipo di chiave: EC → `ecdsa-sha256` con firma IEEE
 * P1363 (r||s, 64 byte per P-256, come vuole XMLDSig; il DER ASN.1 di default di
 * Node NON e' valido), dichiarato in `ds:SignatureMethod`; RSA → `rsa-sha256`
 * come prima (nessun `SignatureMethod`, output invariato).
 */
function costruisciFirmaXades(documenti: DocumentoAsicE[], firma: MaterialeFirmaTest): string {
  const chiavePrivata = crypto.createPrivateKey(firma.chiavePrivataPem)
  const tipoChiave = chiavePrivata.asymmetricKeyType
  if (tipoChiave !== 'rsa' && tipoChiave !== 'ec') {
    throw new Error(`Tipo di chiave non supportato per la firma XAdES: ${tipoChiave ?? 'sconosciuto'}`)
  }
  const certificatoBase64 = new crypto.X509Certificate(firma.certificatoPem).raw.toString('base64')

  const riferimentiXml = documenti
    .map(documento => {
      const digest = crypto.createHash('sha256').update(documento.contenuto, 'utf8').digest('base64')
      return `<ds:Reference URI="${escapeXml(documento.nome)}"><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference>`
    })
    .join('')

  const metodoFirma =
    tipoChiave === 'ec'
      ? '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>'
      : ''
  const signedInfo = `<ds:SignedInfo>${metodoFirma}${riferimentiXml}</ds:SignedInfo>`

  const datiFirmati = Buffer.from(signedInfo, 'utf8')
  const signatureValue = (
    tipoChiave === 'ec'
      ? crypto.sign('sha256', datiFirmati, { key: chiavePrivata, dsaEncoding: 'ieee-p1363' })
      : crypto.sign('sha256', datiFirmati, chiavePrivata)
  ).toString('base64')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<asic:XAdESSignatures xmlns:asic="http://uri.etsi.org/02918/v1.2.1#" ' +
    'xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
    `<ds:Signature>${signedInfo}` +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Certificate>${certificatoBase64}</ds:X509Certificate></ds:KeyInfo>` +
    '</ds:Signature>' +
    '</asic:XAdESSignatures>'
  )
}

function escapeXml(valore: string): string {
  return valore
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * `META-INF/manifest.xml` secondo ETSI TS 102 918: una voce per il contenitore
 * stesso e una per ogni documento, con il tipo di contenuto.
 *
 * Non e' decorativo: e' cio' che distingue un ASiC-E da uno ZIP qualunque, ed
 * e' il motivo per cui il nome del file di firma segue la convenzione
 * `*signatures*.xml` — senza quella distinzione un validatore leggerebbe
 * questo manifest come una firma priva di riferimenti.
 */
function costruisciManifest(documenti: DocumentoAsicE[]): string {
  const voci = documenti
    .map(
      d => `  <manifest:file-entry manifest:full-path="${d.nome}" manifest:media-type="text/xml"/>`
    )
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">',
    `  <manifest:file-entry manifest:full-path="/" manifest:media-type="${MIMETYPE_ASICE}"/>`,
    voci,
    '</manifest:manifest>',
  ].join('\n')
}
