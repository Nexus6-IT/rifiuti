import { ConfigService } from '@nestjs/config'
import { algoritmoDaChiave } from './certificato/algoritmo-da-chiave'

/**
 * Configurazione del client RENTRI.
 *
 * Il client si collega SOLO all'ambiente reale RENTRI (demo o produzione)
 * usando l'autenticazione ID_AUTH_REST_02 del Modello di Interoperabilità
 * AgID in *direct trust*: un JWT self-issued, firmato localmente col
 * certificato X.509 dell'operatore (header `x5c`), passato direttamente come
 * Bearer (RENTRI non espone alcun token endpoint) — e la firma di integrità
 * `Agid-JWT-Signature` su ogni richiesta con body.
 *
 * NB: richiede un certificato (qualificato personale/sigillo o certificato di
 * interoperabilità RENTRI) con la relativa chiave privata, ottenibile
 * nell'area operatori dopo l'accreditamento. Senza certificato il codice è
 * completo ma l'handshake reale non può avvenire.
 *
 * Ambienti ufficiali:
 * - demo: https://demoapi.rentri.gov.it
 * - prod: https://api.rentri.gov.it
 *
 * Per i test automatici, la fake fedele al contratto in `tools/rentri-fake`
 * (autenticazione JWT reale, porta 4010) sostituisce l'ambiente demo — non
 * esiste più una modalità `mock` separata (v. `docs/audits/rentri-conformita-2026-07-25/README.md`).
 */
/** Token DI per iniettare {@link RentriConfig} (interfaccia cancellata a runtime). */
export const RENTRI_CONFIG = Symbol('RENTRI_CONFIG')

export interface RentriConfig {
  /** Base URL del servizio (es. https://demoapi.rentri.gov.it). */
  baseUrl: string
  /** Identificativo operatore (iss/sub del JWT self-issued ID_AUTH_REST_02). */
  clientId: string
  /**
   * Audience (`aud`) attesa dal JWT self-issued ID_AUTH_REST_02 (RENTRI non
   * espone un token endpoint: il JWT è firmato localmente e passato
   * direttamente come Bearer). Default demo: `rentrigov.demo.api`.
   */
  audience: string
  /** Audience attesa dal provider nella firma di integrità Agid-JWT-Signature. */
  signatureAudience: string
  /** Certificato X.509 in PEM (per x5c) usato per firmare i JWT. */
  certificatePem: string
  /** Chiave privata PEM corrispondente al certificato. */
  privateKeyPem: string
  /** Algoritmo di firma JOSE (RS256 per certificati RSA, ES256 per EC). */
  algorithm: 'RS256' | 'ES256'
  /** Validità (secondi) dei JWT generati (autenticazione self-issued / firma di integrità). */
  jwtTtlSeconds: number
  /** Secret per cifrare a riposo le chiavi private RENTRI per-tenant (AES-256-GCM). */
  credentialEncKey: string
}

/**
 * Costruisce la configurazione RENTRI dalle variabili d'ambiente. Default
 * `baseUrl`: ambiente demo ufficiale.
 */
export function loadRentriConfig(config: ConfigService): RentriConfig {
  const baseUrl = config.get<string>('RENTRI_API_URL') || 'https://demoapi.rentri.gov.it'
  const privateKeyPem = normalizePem(config.get<string>('RENTRI_PRIVATE_KEY_PEM'))
  const algorithm = risolviAlgoritmo(privateKeyPem, config.get<string>('RENTRI_JWT_ALG'))

  return {
    baseUrl,
    clientId: config.get<string>('RENTRI_CLIENT_ID') || '',
    audience: config.get<string>('RENTRI_AUDIENCE') || 'rentrigov.demo.api',
    signatureAudience: config.get<string>('RENTRI_SIGNATURE_AUDIENCE') || baseUrl,
    certificatePem: normalizePem(config.get<string>('RENTRI_CERTIFICATE_PEM')),
    privateKeyPem,
    algorithm,
    jwtTtlSeconds: Number(config.get<string>('RENTRI_JWT_TTL_SECONDS')) || 300,
    credentialEncKey: config.get<string>('RENTRI_CREDENTIAL_ENC_KEY') || '',
  }
}

/**
 * Algoritmo di firma: con una chiave privata si ricava SEMPRE da essa (RSA →
 * RS256, EC P-256 → ES256), senza il vecchio ripiego su RS256 che con una
 * chiave EC produceva firme rifiutate. `RENTRI_JWT_ALG`, se impostata, e' solo
 * un controllo: se non coincide con la chiave l'avvio della configurazione
 * fallisce con un errore esplicito. Senza chiave vale la variabile, o RS256.
 */
function risolviAlgoritmo(privateKeyPem: string, dichiarato?: string): 'RS256' | 'ES256' {
  if (dichiarato && dichiarato !== 'RS256' && dichiarato !== 'ES256') {
    throw new Error(`RENTRI_JWT_ALG non valida: ${dichiarato} (ammessi RS256, ES256)`)
  }
  if (!privateKeyPem) return (dichiarato as 'RS256' | 'ES256' | undefined) ?? 'RS256'

  const ricavato = algoritmoDaChiave(privateKeyPem)
  if (dichiarato && dichiarato !== ricavato) {
    throw new Error(
      `RENTRI_JWT_ALG=${dichiarato} non coincide con la chiave privata configurata (${ricavato})`
    )
  }
  return ricavato
}

/**
 * Le chiavi/certificati negli env spesso hanno i newline come `\n` letterali:
 * li ripristina in newline reali così che il PEM sia valido.
 */
function normalizePem(value?: string): string {
  if (!value) return ''
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
}
