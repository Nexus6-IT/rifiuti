// Web push VAPID (RFC 8292) con il solo `node:crypto`: nessuna dipendenza esterna.
//
// L'invio e' SENZA payload (nessun corpo, nessuna cifratura RFC 8291): il browser riceve l'evento
// `push` vuoto e mostra un testo generico, poi l'app rilegge online. Per questo servono solo la
// firma VAPID (JWT ES256) e le chiavi del server. Se un giorno servira' un payload (tipo di avviso
// opaco) andra' aggiunta la cifratura aes128gcm, ad esempio con il pacchetto `web-push`.
import { createPrivateKey, createPublicKey, createECDH, sign, type KeyObject } from 'node:crypto'

export interface ChiaviVapid {
  /** Chiave pubblica del server, base64url, 65 byte non compressi (`applicationServerKey`). */
  pubblica: string
  /** Chiave privata, base64url, 32 byte. */
  privata: string
}

export interface ChiaviVapidCaricate {
  pubblica: string
  soggetto: string
  chiavePrivata: KeyObject
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

/** Genera una nuova coppia VAPID (per `ops` / documentazione: `node -e` o lo script del repo). */
export function generaChiaviVapid(): ChiaviVapid {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  // getPrivateKey() toglie gli zeri iniziali (1 volta su 256 darebbe 31 byte): si riporta a 32.
  const privata = ecdh.getPrivateKey()
  const piena = Buffer.concat([Buffer.alloc(32 - privata.length), privata])
  return { pubblica: ecdh.getPublicKey().toString('base64url'), privata: piena.toString('base64url') }
}

/**
 * Carica le chiavi dall'ambiente. Qualsiasi anomalia (assenti, incomplete, malformate, privata che
 * non corrisponde alla pubblica, soggetto che non e' `mailto:` o `https:`) restituisce `null`: la
 * funzione push resta SPENTA, mai un errore all'avvio.
 */
export function caricaChiaviVapid(env: {
  pubblica?: string
  privata?: string
  soggetto?: string
}): ChiaviVapidCaricate | null {
  const pubblica = env.pubblica?.trim()
  const privata = env.privata?.trim()
  const soggetto = env.soggetto?.trim()
  if (!pubblica || !privata || !soggetto) return null
  if (!BASE64URL.test(pubblica) || !BASE64URL.test(privata)) return null
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(soggetto)) return null
  const pub = Buffer.from(pubblica, 'base64url')
  const priv = Buffer.from(privata, 'base64url')
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return null
  try {
    const chiavePrivata = createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: privata,
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    })
    // La privata deve generare proprio quella pubblica.
    const derivata = createPublicKey(chiavePrivata).export({ format: 'jwk' })
    if (derivata.x !== pub.subarray(1, 33).toString('base64url')) return null
    if (derivata.y !== pub.subarray(33, 65).toString('base64url')) return null
    return { pubblica, soggetto, chiavePrivata }
  } catch {
    return null
  }
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')

/** Intestazione `Authorization: vapid t=<JWT>, k=<pubblica>` per l'endpoint indicato. */
export function creaIntestazioneVapid(
  chiavi: ChiaviVapidCaricate,
  endpoint: string,
  adessoSecondi: number = Math.floor(Date.now() / 1000)
): string {
  const aud = new URL(endpoint).origin
  const testa = b64({ typ: 'JWT', alg: 'ES256' })
  // exp <= 24 ore (RFC 8292): 12 ore.
  const corpo = b64({ aud, exp: adessoSecondi + 12 * 3600, sub: chiavi.soggetto })
  const firma = sign('sha256', Buffer.from(`${testa}.${corpo}`), {
    key: chiavi.chiavePrivata,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `vapid t=${testa}.${corpo}.${firma}, k=${chiavi.pubblica}`
}

/** Host dei servizi push dei browser. Un suffisso vale solo con il punto davanti (host intero). */
const HOST_ESATTI = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'web.push.apple.com'])
const SUFFISSI = [
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.apple.com',
]

/**
 * Difesa SSRF: l'endpoint lo sceglie il client e il server lo chiama. Si ammettono solo https sulla
 * porta predefinita, senza credenziali, verso i servizi push noti (niente IP, niente localhost).
 */
export function endpointPushAmmesso(endpoint: string): boolean {
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false
  const host = u.hostname.toLowerCase()
  if (HOST_ESATTI.has(host)) return true
  return SUFFISSI.some(s => host.endsWith(s) && host.length > s.length)
}
