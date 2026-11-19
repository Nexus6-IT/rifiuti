import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * Cifratura simmetrica di segreti a riposo (AES-256-GCM), condivisa fra RENTRI e SDI.
 *
 * Formato serializzato: `iv:authTag:ciphertext` (base64). La chiave AES deriva (SHA-256) dal
 * secret applicativo; `nomeVariabile` serve solo ai messaggi d'errore (quale env manca).
 */
const ALGORITMO = 'aes-256-gcm'
const BYTE_IV = 12

function derivaChiave(secret: string, nomeVariabile: string): Buffer {
  if (!secret) throw new Error(`${nomeVariabile} non configurato`)
  return createHash('sha256').update(secret, 'utf8').digest()
}

/** Cifra `testo` con il secret; ritorna `iv:tag:ciphertext` (base64). */
export function cifraSegreto(testo: string, secret: string, nomeVariabile: string): string {
  const iv = randomBytes(BYTE_IV)
  const cifrario = createCipheriv(ALGORITMO, derivaChiave(secret, nomeVariabile), iv)
  const dati = Buffer.concat([cifrario.update(testo, 'utf8'), cifrario.final()])
  const tag = cifrario.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), dati.toString('base64')].join(':')
}

/** Decifra un payload prodotto da {@link cifraSegreto}; lancia se alterato o con chiave errata. */
export function decifraSegreto(payload: string, secret: string, nomeVariabile: string): string {
  const chiave = derivaChiave(secret, nomeVariabile)
  const parti = payload.split(':')
  if (parti.length !== 3) throw new Error('payload cifrato non valido')
  const [iv, tag, dati] = parti
  const decifrario = createDecipheriv(ALGORITMO, chiave, Buffer.from(iv, 'base64'))
  decifrario.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decifrario.update(Buffer.from(dati, 'base64')),
    decifrario.final(),
  ]).toString('utf8')
}
