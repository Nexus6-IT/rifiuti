import { cifraSegreto, decifraSegreto } from '../crypto/segreti'

/**
 * Cifratura della chiave privata RENTRI a riposo (AES-256-GCM, `iv:authTag:ciphertext`).
 * L'implementazione sta in `infrastructure/crypto/segreti.ts` (condivisa con l'SDI); qui restano
 * i nomi storici e i messaggi con il prefisso RENTRI. Il secret e' `RENTRI_CREDENTIAL_ENC_KEY`.
 */
const VARIABILE = 'RENTRI_CREDENTIAL_ENC_KEY'

/** Cifra `plaintext` con il secret; ritorna `iv:tag:ciphertext` (base64). */
export function encryptSecret(plaintext: string, secret: string): string {
  try {
    return cifraSegreto(plaintext, secret, VARIABILE)
  } catch (e) {
    throw new Error(`RENTRI: ${(e as Error).message}`)
  }
}

/** Decifra un payload `iv:tag:ciphertext` prodotto da {@link encryptSecret}. */
export function decryptSecret(payload: string, secret: string): string {
  try {
    return decifraSegreto(payload, secret, VARIABILE)
  } catch (e) {
    throw new Error(`RENTRI: ${(e as Error).message}`)
  }
}
