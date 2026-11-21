/**
 * Validazione di una ricevuta di ritiro dal campo (P6): forma e limiti, senza accedere al database.
 * La sostanza (ritiro dell'autista, stato, tetto per ritiro) la decide `RicevuteRitiroService`.
 *
 * La firma arriva come PNG in base64 e viene controllata nella STRUTTURA (magic bytes, intestazione
 * IHDR, chiusura IEND, dimensioni): niente decodifica dei pixel, ma un file che non e' un PNG, o che
 * e' troncato o fuori scala, non entra mai nel database ne' nel PDF.
 */
export const LIMITE_FIRMA_BYTE = 131_072
export const LARGHEZZA_FIRMA = { min: 50, max: 1200 }
export const ALTEZZA_FIRMA = { min: 20, max: 800 }
export const LUNGHEZZA_NOME_FIRMATARIO = { min: 2, max: 120 }

export interface RicevutaCampoValori {
  id: string
  ritiroId: string
  firmatarioNome: string
  /** Orologio del telefono: informativo, mai data legale. */
  firmatoIl: Date
  firmaPng: Buffer
  larghezza: number
  altezza: number
  /** Solo se l'autista ha chiesto l'invio al cliente; il servizio lo ignora se l'invio e' spento. */
  emailCliente: string | null
}

export type EsitoValidazioneRicevuta =
  | { ok: true; valori: RicevutaCampoValori }
  | { ok: false; messaggi: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_CON_ORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const EMAIL = /^[^\s@<>()[\],;:\\"]+@[^\s@<>()[\],;:\\"]+\.[^\s@<>()[\],;:\\"]{2,}$/
const ANNO_MINIMO = 2020
const ANNO_MASSIMO = 2100
const MAGIC_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Chunk IEND: lunghezza 0, tipo, CRC fisso. */
const CODA_PNG = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
const LUNGHEZZA_EMAIL_MASSIMA = 254

function leggiPng(base64: unknown): { png: Buffer; w: number; h: number } | string {
  if (typeof base64 !== 'string' || base64 === '') return 'La firma è obbligatoria.'
  // 4/3 della dimensione massima, con un margine per gli a capo: oltre, non si decodifica nemmeno.
  if (base64.length > Math.ceil((LIMITE_FIRMA_BYTE * 4) / 3) + 8) return 'La firma è troppo grande.'
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) return 'La firma non è valida.'
  const png = Buffer.from(base64, 'base64')
  if (png.length > LIMITE_FIRMA_BYTE) return 'La firma è troppo grande.'
  // 8 magic + 25 IHDR (len+tipo+13+crc) + IEND (12)
  if (png.length < 45 || !png.subarray(0, 8).equals(MAGIC_PNG)) return 'La firma non è un PNG.'
  if (png.subarray(12, 16).toString('ascii') !== 'IHDR' || png.readUInt32BE(8) !== 13) {
    return 'La firma non è un PNG valido.'
  }
  if (!png.subarray(png.length - 12).equals(CODA_PNG)) return 'La firma è incompleta.'
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  if (
    w < LARGHEZZA_FIRMA.min ||
    w > LARGHEZZA_FIRMA.max ||
    h < ALTEZZA_FIRMA.min ||
    h > ALTEZZA_FIRMA.max
  ) {
    return 'Le dimensioni della firma non sono ammesse.'
  }
  return { png, w, h }
}

export function normalizzaRicevutaCampo(grezzo: {
  id?: unknown
  ritiroId?: unknown
  firmatarioNome?: unknown
  firmatoIl?: unknown
  firmaPng?: unknown
  emailCliente?: unknown
}): EsitoValidazioneRicevuta {
  const messaggi: string[] = []

  const id = typeof grezzo.id === 'string' && UUID.test(grezzo.id) ? grezzo.id.toLowerCase() : null
  if (id === null) messaggi.push("L'identificativo della ricevuta non è valido.")
  const ritiroId =
    typeof grezzo.ritiroId === 'string' && UUID.test(grezzo.ritiroId)
      ? grezzo.ritiroId.toLowerCase()
      : null
  if (ritiroId === null) messaggi.push('Il ritiro non è valido.')

  let nome: string | null = null
  if (typeof grezzo.firmatarioNome === 'string') {
    const grezzoNome = grezzo.firmatarioNome
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u001f\u007f]/.test(grezzoNome)) {
      const pulito = grezzoNome.replace(/\s+/g, ' ').trim()
      if (
        pulito.length >= LUNGHEZZA_NOME_FIRMATARIO.min &&
        pulito.length <= LUNGHEZZA_NOME_FIRMATARIO.max &&
        /\p{L}/u.test(pulito)
      ) {
        nome = pulito
      }
    }
  }
  if (nome === null) messaggi.push('Il nome di chi firma non è valido (almeno 2 caratteri, con lettere).')

  let firmatoIl: Date | null = null
  if (typeof grezzo.firmatoIl === 'string' && ISO_CON_ORA.test(grezzo.firmatoIl)) {
    const d = new Date(grezzo.firmatoIl)
    if (
      !Number.isNaN(d.getTime()) &&
      d.getUTCFullYear() >= ANNO_MINIMO &&
      d.getUTCFullYear() <= ANNO_MASSIMO
    ) {
      firmatoIl = d
    }
  }
  if (firmatoIl === null) messaggi.push("L'ora della firma non è valida.")

  const firma = leggiPng(grezzo.firmaPng)
  if (typeof firma === 'string') messaggi.push(firma)

  let emailCliente: string | null = null
  if (grezzo.emailCliente !== undefined && grezzo.emailCliente !== null) {
    if (typeof grezzo.emailCliente !== 'string') {
      messaggi.push("L'indirizzo email del cliente non è valido.")
    } else {
      const e = grezzo.emailCliente.trim().toLowerCase()
      if (e !== '') {
        if (e.length > LUNGHEZZA_EMAIL_MASSIMA || !EMAIL.test(e)) {
          messaggi.push("L'indirizzo email del cliente non è valido.")
        } else {
          emailCliente = e
        }
      }
    }
  }

  if (messaggi.length > 0 || id === null || ritiroId === null || nome === null) {
    return { ok: false, messaggi }
  }
  if (firmatoIl === null || typeof firma === 'string') return { ok: false, messaggi }
  return {
    ok: true,
    valori: {
      id,
      ritiroId,
      firmatarioNome: nome,
      firmatoIl,
      firmaPng: firma.png,
      larghezza: firma.w,
      altezza: firma.h,
      emailCliente,
    },
  }
}

/** `mario.rossi@ditta.it` → `m***@ditta.it`: l'indirizzo intero non si conserva e non si logga. */
export function mascheraEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
