import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto'
import * as forge from 'node-forge'
import { calcolaGiorniAllaScadenzaCertificato } from '../rentri-certificato-scadenza.util'

/**
 * Validazione statica di un certificato RENTRI (+ chiave privata) — nessuna
 * chiamata di rete, funzione pura.
 *
 * Colma parte della lacuna rilevata da un audit di conformità: oggi il
 * certificato di interoperabilità caricato dal tenant viene controllato
 * SOLO sulla scadenza (`rentri-certificato-scadenza.util.ts`, riusata qui,
 * non duplicata). Questo modulo aggiunge:
 *
 *  1. scadenza (riuso di `calcolaGiorniAllaScadenzaCertificato`)
 *  2. coerenza fra chiave privata e certificato
 *  3. catena di certificazione
 *  4. presenza di endpoint di revoca dichiarati (CRL/OCSP) — SOLO rilevazione
 *     locale, NESSUNA verifica di revoca reale (v. sezione dedicata sotto)
 *
 * ## Perché niente verifica di revoca reale (CRL/OCSP) via rete
 *
 * Una verifica di revoca vera richiederebbe di contattare un'autorità esterna
 * (scaricare una CRL o interrogare un responder OCSP), il che introduce una
 * dipendenza di rete in un percorso — il caricamento del certificato — che
 * deve restare veloce e affidabile. Il rischio concreto è l'inverso di
 * quello che vogliamo evitare: un'autorità irraggiungibile o lenta NON
 * significa "certificato revocato", ma un controllo implementato in fretta
 * tende a confondere i due casi e finisce per bloccare caricamenti legittimi
 * per un problema di rete altrui.
 *
 * A questo si aggiunge che `node-forge` (l'unica libreria di parsing X.509
 * già disponibile in questo backend) non implementa il protocollo OCSP né
 * il parsing strutturato delle CRL: costruire richiesta/risposta OCSP a
 * mano, o scaricare e validare una CRL, è lavoro non banale che questo task
 * non può permettersi di fare "in fretta e male" — rischierebbe di dare un
 * falso senso di sicurezza (un bollino "revoca verificata" che in realtà non
 * verifica quasi nulla).
 *
 * Quello che QUESTO modulo fa, in modo onesto e a costo zero (nessuna rete):
 * rileva se il certificato dichiara un'estensione X.509v3
 * `cRLDistributionPoints` o `authorityInfoAccess` (OCSP). È solo metadato —
 * non dice se il certificato è revocato — ma è comunque utile: se anche in
 * futuro volessimo implementare la verifica reale, un certificato senza
 * queste estensioni non la supporterebbe comunque. Esito sempre
 * `avvertimento`, mai `errore` né `ok` (perché "ok" implicherebbe una
 * verifica che non è stata fatta).
 */

export type EsitoControlloCertificato = 'ok' | 'avvertimento' | 'errore'

export interface ControlloCertificato {
  esito: EsitoControlloCertificato
  messaggio: string
}

export interface RisultatoValidazioneCertificato {
  /** `true` se nessun controllo ha esito `errore` (gli `avvertimento` non bloccano). */
  valido: boolean
  controlli: {
    scadenza: ControlloCertificato
    coerenzaChiave: ControlloCertificato
    catena: ControlloCertificato
    revoca: ControlloCertificato
  }
}

/**
 * Soglia di avviso per la scadenza in giorni. Duplicata deliberatamente da
 * `RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30`
 * (`get-rentri-diagnostica.use-case.ts`, strato application) invece di
 * importata: questo modulo vive nello strato infrastructure e non deve
 * dipendere dall'application layer. Stesso valore (30), tenerli allineati se
 * la soglia cambia in uno dei due punti.
 */
const SOGLIA_AVVISO_SCADENZA_GIORNI = 30

function validaScadenza(certificatePem: string): ControlloCertificato {
  const giorni = calcolaGiorniAllaScadenzaCertificato(certificatePem)

  if (giorni === null) {
    return {
      esito: 'errore',
      messaggio: 'certificato non analizzabile: impossibile leggere la data di scadenza',
    }
  }
  if (giorni < 0) {
    return { esito: 'errore', messaggio: `certificato scaduto da ${Math.abs(giorni)} giorni` }
  }
  if (giorni <= SOGLIA_AVVISO_SCADENZA_GIORNI) {
    return { esito: 'avvertimento', messaggio: `il certificato scade tra ${giorni} giorni` }
  }
  return { esito: 'ok', messaggio: `il certificato scade tra ${giorni} giorni` }
}

function validaCoerenzaChiave(certificatePem: string, privateKeyPem: string): ControlloCertificato {
  try {
    const certificato = new X509Certificate(certificatePem)
    const chiavePubblicaCertificato = certificato.publicKey
    const chiavePrivata = createPrivateKey(privateKeyPem)
    const chiavePubblicaDaChiavePrivata = createPublicKey(chiavePrivata)

    const derCertificato = chiavePubblicaCertificato.export({ type: 'spki', format: 'der' })
    const derChiavePrivata = chiavePubblicaDaChiavePrivata.export({ type: 'spki', format: 'der' })

    if (!derCertificato.equals(derChiavePrivata)) {
      return {
        esito: 'errore',
        messaggio:
          'la chiave privata non corrisponde alla chiave pubblica del certificato: le firme prodotte verrebbero rifiutate da RENTRI',
      }
    }
    return { esito: 'ok', messaggio: 'la chiave privata corrisponde al certificato' }
  } catch {
    // Certificato o chiave illeggibili: non possiamo nemmeno confrontarli.
    return {
      esito: 'errore',
      messaggio: 'certificato o chiave privata illeggibili: impossibile verificarne la coerenza',
    }
  }
}

function validaCatena(certificatePem: string): ControlloCertificato {
  try {
    // X509Certificate (Node) invece di forge.pki: forge lancia "OID is not RSA"
    // sui certificati EC. Subject e issuer sono stringhe canoniche.
    const certificato = new X509Certificate(certificatePem)
    const autoFirmato = certificato.subject === certificato.issuer

    if (autoFirmato) {
      return {
        esito: 'avvertimento',
        messaggio:
          "il certificato è auto-firmato (issuer coincide col subject): RENTRI richiede tipicamente un certificato emesso da una CA riconosciuta, non uno auto-firmato — verificalo con l'ente prima di usarlo in produzione",
      }
    }

    // Anche quando il certificato NON è auto-firmato, la pipeline di
    // caricamento attuale non conserva la catena: `parsePkcs12`
    // (`rentri-pkcs12.util.ts`) estrae UN SOLO certBag dal PKCS#12 —
    // qualunque CA intermedia presente nel file originale viene scartata.
    // Non possiamo quindi mai dichiarare la catena "completa".
    return {
      esito: 'avvertimento',
      messaggio:
        'il certificato non è auto-firmato, ma la pipeline di caricamento estrae un solo certificato dal PKCS#12 (v. rentri-pkcs12.util.ts): eventuali CA intermedie della catena originale non vengono conservate né verificate qui',
    }
  } catch {
    return {
      esito: 'errore',
      messaggio: 'certificato illeggibile: impossibile analizzare la catena',
    }
  }
}

const OID_CRL_DISTRIBUTION_POINTS = '2.5.29.31'
const OID_AUTHORITY_INFO_ACCESS = '1.3.6.1.5.5.7.1.1'

/**
 * OID delle estensioni X.509v3 dichiarate dal certificato, letti dall'ASN.1 del
 * DER: Certificate ::= SEQ { tbs SEQ { ..., [3] EXPLICIT SEQ OF Extension }, ... },
 * con Extension ::= SEQ { extnID OID, ... }. Indipendente dal tipo di chiave.
 */
function oidEstensioni(certificato: X509Certificate): Set<string> {
  const radice = forge.asn1.fromDer(forge.util.createBuffer(certificato.raw.toString('binary')))
  const tbs = (radice.value as forge.asn1.Asn1[])[0]
  const blocco = (tbs.value as forge.asn1.Asn1[]).find(
    n => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 3
  )
  const oid = new Set<string>()
  if (!blocco) return oid
  const estensioni = (blocco.value as forge.asn1.Asn1[])[0]
  for (const estensione of estensioni.value as forge.asn1.Asn1[]) {
    const id = (estensione.value as forge.asn1.Asn1[])[0]
    oid.add(forge.asn1.derToOid(id.value as string))
  }
  return oid
}

function validaRevoca(certificatePem: string): ControlloCertificato {
  try {
    const oid = oidEstensioni(new X509Certificate(certificatePem))
    const haCrl = oid.has(OID_CRL_DISTRIBUTION_POINTS)
    const haAia = oid.has(OID_AUTHORITY_INFO_ACCESS)

    if (haCrl || haAia) {
      return {
        esito: 'avvertimento',
        messaggio:
          "il certificato dichiara endpoint di revoca (CRL e/o OCSP), ma questa verifica NON contatta l'autorità: nessuna chiamata di rete viene fatta all'upload, quindi lo stato di revoca reale resta non verificato",
      }
    }
    return {
      esito: 'avvertimento',
      messaggio:
        'il certificato non dichiara alcun endpoint di revoca (CRL/OCSP): anche in futuro non sarebbe possibile verificarne la revoca automaticamente',
    }
  } catch {
    return {
      esito: 'errore',
      messaggio: 'certificato illeggibile: impossibile rilevare gli endpoint di revoca',
    }
  }
}

/** Valida staticamente un certificato RENTRI + la sua chiave privata. Non lancia mai. */
export function validaCertificato(
  certificatePem: string,
  privateKeyPem: string
): RisultatoValidazioneCertificato {
  const controlli = {
    scadenza: validaScadenza(certificatePem),
    coerenzaChiave: validaCoerenzaChiave(certificatePem, privateKeyPem),
    catena: validaCatena(certificatePem),
    revoca: validaRevoca(certificatePem),
  }

  const valido = Object.values(controlli).every(c => c.esito !== 'errore')

  return { valido, controlli }
}
