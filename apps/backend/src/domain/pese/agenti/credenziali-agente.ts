import { createHash, createPublicKey, randomBytes, randomInt, type KeyObject } from 'crypto'

/**
 * Credenziali dell'agente di pesa (Fase 4 pezzo 8b, D5). Dominio puro: nessun accesso a database.
 *
 * - Codice di abbinamento: 12 caratteri Crockford base32 senza I, L, O, U (60 bit), 15 minuti di
 *   vita (la scadenza la applica il servizio). Nel database solo lo SHA-256.
 * - Token dell'agente: `wfpa_` + 32 byte casuali in base64url. 256 bit di entropia: basta lo
 *   SHA-256 (niente bcrypt) e la ricerca per uguaglianza sull'indice unico.
 */

/** Crockford base32 senza I, L, O, U: 32 simboli. */
export const ALFABETO_CODICE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const LUNGHEZZA_CODICE = 12
export const MINUTI_VALIDITA_CODICE = 15
export const PREFISSO_TOKEN = 'wfpa_'

/** Prefisso DER (SPKI) di una chiave pubblica Ed25519; seguono i 32 byte grezzi. */
const PREFISSO_SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

export function generaCodice(): string {
  let c = ''
  for (let i = 0; i < LUNGHEZZA_CODICE; i++) c += ALFABETO_CODICE[randomInt(ALFABETO_CODICE.length)]
  return c
}

/** `ABCDEFGHJK23` → `ABCD-EFGH-JK23` (solo per mostrarlo). */
export function formattaCodice(codice: string): string {
  return codice.replace(/(.{4})(?=.)/g, '$1-')
}

/**
 * Ripulisce il codice digitato: toglie spazi e trattini, maiuscole, `O→0`, `I/L→1`.
 * `null` se la lunghezza o i caratteri non sono quelli dell'alfabeto.
 */
export function normalizzaCodice(input: string): string | null {
  const c = input.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  if (c.length !== LUNGHEZZA_CODICE) return null
  for (const ch of c) if (!ALFABETO_CODICE.includes(ch)) return null
  return c
}

export function generaToken(): string {
  return PREFISSO_TOKEN + randomBytes(32).toString('base64url')
}

/** Forma valida di un token, controllata prima di toccare il database. */
export function tokenBenFormato(token: string): boolean {
  return /^wfpa_[A-Za-z0-9_-]{43}$/.test(token)
}

/** SHA-256 esadecimale (64 caratteri minuscoli). */
export function hashSegreto(segreto: string): string {
  return createHash('sha256').update(segreto, 'utf8').digest('hex')
}

/** Base64 standard rigoroso: alfabeto, padding e ricodifica identici all'originale. */
export function decodificaBase64Rigorosa(s: string): Buffer | null {
  if (s.length === 0 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null
  const b = Buffer.from(s, 'base64')
  return b.toString('base64') === s ? b : null
}

/** Chiave pubblica Ed25519 da 32 byte in base64 standard; `null` se non è valida. */
export function chiavePubblicaDaBase64(s: string): KeyObject | null {
  const raw = decodificaBase64Rigorosa(s)
  if (!raw || raw.length !== 32) return null
  try {
    return createPublicKey({
      key: Buffer.concat([PREFISSO_SPKI_ED25519, raw]),
      format: 'der',
      type: 'spki',
    })
  } catch {
    return null
  }
}

/** SHA-256 esadecimale dei 32 byte della chiave: mostrato in UI per il riscontro a vista. */
export function improntaChiave(chiaveB64: string): string {
  const raw = decodificaBase64Rigorosa(chiaveB64)
  if (!raw || raw.length !== 32) throw new Error('Chiave pubblica non valida.')
  return createHash('sha256').update(raw).digest('hex')
}
