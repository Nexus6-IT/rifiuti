import { ConfigService } from '@nestjs/config'

/**
 * Configurazione del client RENTRI.
 *
 * Il client opera in due modalità (`RENTRI_MODE`):
 * - `mock`  → usa il mock locale (`tools/rentri-mock`) con header `X-API-Key`.
 *   È la modalità di default per sviluppo e test automatici.
 * - `live`  → si collega all'ambiente reale RENTRI (demo o produzione) usando
 *   l'autenticazione ID_AUTH_REST_02 del Modello di Interoperabilità AgID in
 *   *direct trust*: un JWT self-issued, firmato localmente col certificato
 *   X.509 dell'operatore (header `x5c`), passato direttamente come Bearer
 *   (RENTRI non espone alcun token endpoint) — e la firma di integrità
 *   `Agid-JWT-Signature` su ogni richiesta con body.
 *
 * NB: la modalità `live` richiede un certificato (qualificato personale/sigillo
 * o certificato di interoperabilità RENTRI) con la relativa chiave privata,
 * ottenibile nell'area operatori dopo l'accreditamento. Senza certificato il
 * codice è completo ma l'handshake reale non può avvenire.
 *
 * Ambienti ufficiali:
 * - demo: https://demoapi.rentri.gov.it
 * - prod: https://api.rentri.gov.it
 */
/** Token DI per iniettare {@link RentriConfig} (interfaccia cancellata a runtime). */
export const RENTRI_CONFIG = Symbol('RENTRI_CONFIG')

export type RentriMode = 'mock' | 'live'

export interface RentriConfig {
  mode: RentriMode
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
  /** API key usata SOLO in modalità mock. */
  mockApiKey: string
  /** Validità (secondi) dei JWT generati (autenticazione self-issued / firma di integrità). */
  jwtTtlSeconds: number
  /** Secret per cifrare a riposo le chiavi private RENTRI per-tenant (AES-256-GCM). */
  credentialEncKey: string
}

/**
 * Costruisce la configurazione RENTRI dalle variabili d'ambiente, con default
 * orientati allo sviluppo (mock). Retro-compatibile con `RENTRI_ENABLE_MOCK`.
 */
export function loadRentriConfig(config: ConfigService): RentriConfig {
  const explicitMode = config.get<string>('RENTRI_MODE')
  const legacyMock = config.get<string>('RENTRI_ENABLE_MOCK')
  const mode: RentriMode =
    explicitMode === 'live' || (explicitMode == null && legacyMock === 'false') ? 'live' : 'mock'

  const baseUrl =
    config.get<string>('RENTRI_API_URL') ||
    (mode === 'live' ? 'https://demoapi.rentri.gov.it' : 'http://localhost:3001')

  return {
    mode,
    baseUrl,
    clientId: config.get<string>('RENTRI_CLIENT_ID') || '',
    audience: config.get<string>('RENTRI_AUDIENCE') || 'rentrigov.demo.api',
    signatureAudience: config.get<string>('RENTRI_SIGNATURE_AUDIENCE') || baseUrl,
    certificatePem: normalizePem(config.get<string>('RENTRI_CERTIFICATE_PEM')),
    privateKeyPem: normalizePem(config.get<string>('RENTRI_PRIVATE_KEY_PEM')),
    algorithm: (config.get<string>('RENTRI_JWT_ALG') as 'RS256' | 'ES256') || 'RS256',
    mockApiKey: config.get<string>('RENTRI_API_KEY') || 'demo-key',
    jwtTtlSeconds: Number(config.get<string>('RENTRI_JWT_TTL_SECONDS')) || 300,
    credentialEncKey: config.get<string>('RENTRI_CREDENTIAL_ENC_KEY') || '',
  }
}

/**
 * Le chiavi/certificati negli env spesso hanno i newline come `\n` letterali:
 * li ripristina in newline reali così che il PEM sia valido.
 */
function normalizePem(value?: string): string {
  if (!value) return ''
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
}
