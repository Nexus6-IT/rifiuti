import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

/**
 * Cifratura simmetrica della chiave privata RENTRI a riposo (AES-256-GCM).
 *
 * Le chiavi private dei certificati di interoperabilità NON devono mai essere
 * salvate in chiaro nel DB. Qui si cifra con AES-256-GCM (autenticato): il
 * formato serializzato è `iv:authTag:ciphertext` (tutti base64).
 *
 * La chiave di cifratura deriva (SHA-256) dal secret applicativo
 * `RENTRI_CREDENTIAL_ENC_KEY`. In produzione usare un secret forte e, idealmente,
 * un KMS dedicato.
 */
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function deriveKey(secret: string): Buffer {
  if (!secret) {
    throw new Error('RENTRI: RENTRI_CREDENTIAL_ENC_KEY non configurato')
  }
  // 32 byte deterministici dal secret (AES-256).
  return createHash('sha256').update(secret, 'utf8').digest()
}

/** Cifra `plaintext` con il secret; ritorna `iv:tag:ciphertext` (base64). */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, deriveKey(secret), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

/** Decifra un payload `iv:tag:ciphertext` prodotto da {@link encryptSecret}. */
export function decryptSecret(payload: string, secret: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('RENTRI: payload cifrato non valido')
  }
  const [ivB, tagB, dataB] = parts
  const decipher = createDecipheriv(ALGO, deriveKey(secret), Buffer.from(ivB, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
