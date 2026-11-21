import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import {
  caricaChiaviVapid,
  creaIntestazioneVapid,
  endpointPushAmmesso,
  generaChiaviVapid,
} from './vapid'

const decodifica = (s: string) => Buffer.from(s, 'base64url')

describe('endpointPushAmmesso (difesa SSRF: l’endpoint lo sceglie il client)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QNHx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://eu.push.apple.com/abc',
  ])('ammette %s', url => {
    expect(endpointPushAmmesso(url)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://[::1]/x',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com@evil.example/x',
    'https://utente:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://notifica.push.apple.com.example.org/x',
    'ftp://fcm.googleapis.com/x',
    'non un url',
    '',
  ])('rifiuta %s', url => {
    expect(endpointPushAmmesso(url)).toBe(false)
  })
})

describe('chiavi VAPID', () => {
  it('generaChiaviVapid produce una coppia nel formato atteso (65 e 32 byte base64url)', () => {
    const k = generaChiaviVapid()
    expect(decodifica(k.pubblica)).toHaveLength(65)
    expect(decodifica(k.pubblica)[0]).toBe(4)
    expect(decodifica(k.privata)).toHaveLength(32)
  })

  it('generaChiaviVapid: privata sempre di 32 byte e caricabile (anche con zero iniziale)', () => {
    for (let i = 0; i < 600; i++) {
      const k = generaChiaviVapid()
      expect(decodifica(k.privata)).toHaveLength(32)
      expect(caricaChiaviVapid({ pubblica: k.pubblica, privata: k.privata, soggetto: 'mailto:a@b.it' })).not.toBeNull()
    }
  })

  it('caricaChiaviVapid: assenti -> null (funzione spenta), nessun errore', () => {
    expect(caricaChiaviVapid({ pubblica: undefined, privata: undefined, soggetto: undefined })).toBeNull()
    expect(caricaChiaviVapid({ pubblica: '', privata: '', soggetto: '' })).toBeNull()
  })

  it('caricaChiaviVapid: incomplete o malformate -> null (spenta, mai un errore all’avvio)', () => {
    const k = generaChiaviVapid()
    expect(caricaChiaviVapid({ pubblica: k.pubblica, privata: undefined, soggetto: 'mailto:a@b.it' })).toBeNull()
    expect(caricaChiaviVapid({ pubblica: 'xx', privata: k.privata, soggetto: 'mailto:a@b.it' })).toBeNull()
    expect(caricaChiaviVapid({ pubblica: k.pubblica, privata: 'xx', soggetto: 'mailto:a@b.it' })).toBeNull()
    expect(caricaChiaviVapid({ pubblica: k.pubblica, privata: k.privata, soggetto: 'info' })).toBeNull()
  })

  it('caricaChiaviVapid: una privata che non corrisponde alla pubblica e` rifiutata', () => {
    const a = generaChiaviVapid()
    const b = generaChiaviVapid()
    expect(caricaChiaviVapid({ pubblica: a.pubblica, privata: b.privata, soggetto: 'mailto:a@b.it' })).toBeNull()
  })

  it('caricaChiaviVapid: coppia valida', () => {
    const k = generaChiaviVapid()
    const c = caricaChiaviVapid({ pubblica: k.pubblica, privata: k.privata, soggetto: 'mailto:a@b.it' })
    expect(c).not.toBeNull()
    expect(c?.pubblica).toBe(k.pubblica)
  })
})

describe('creaIntestazioneVapid (RFC 8292)', () => {
  const k = generaChiaviVapid()
  const chiavi = caricaChiaviVapid({ pubblica: k.pubblica, privata: k.privata, soggetto: 'mailto:a@b.it' })!

  it('JWT ES256 con aud = origine dell’endpoint, exp breve, firma verificabile con la pubblica', () => {
    const adesso = 1_800_000_000
    const h = creaIntestazioneVapid(chiavi, 'https://fcm.googleapis.com/fcm/send/xyz', adesso)
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)
    expect(m).not.toBeNull()
    const [, intestazione, corpo, firma, chiave] = m!
    expect(chiave).toBe(k.pubblica)
    expect(JSON.parse(decodifica(intestazione).toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    const c = JSON.parse(decodifica(corpo).toString())
    expect(c.aud).toBe('https://fcm.googleapis.com')
    expect(c.sub).toBe('mailto:a@b.it')
    expect(c.exp).toBeGreaterThan(adesso)
    expect(c.exp - adesso).toBeLessThanOrEqual(12 * 3600)
    expect(decodifica(firma)).toHaveLength(64)

    const raw = decodifica(k.pubblica)
    const pubblica = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: raw.subarray(1, 33).toString('base64url'),
        y: raw.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    })
    expect(
      verify('sha256', Buffer.from(`${intestazione}.${corpo}`), { key: pubblica, dsaEncoding: 'ieee-p1363' }, decodifica(firma))
    ).toBe(true)
  })

  it('non firma niente di piu` dei campi attesi (nessun dato dell’azienda nel JWT)', () => {
    const h = creaIntestazioneVapid(chiavi, 'https://web.push.apple.com/abc', 1_800_000_000)
    const corpo = JSON.parse(decodifica(h.split('t=')[1].split('.')[1]).toString())
    expect(Object.keys(corpo).sort()).toEqual(['aud', 'exp', 'sub'])
  })

  it('generateKeyPairSync e` disponibile (sanity del runtime)', () => {
    expect(typeof generateKeyPairSync).toBe('function')
  })
})
