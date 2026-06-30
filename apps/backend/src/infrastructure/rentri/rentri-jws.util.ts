import * as jwt from 'jsonwebtoken'

/**
 * Utility per la firma JWT/JWS conforme al Modello di Interoperabilità AgID
 * usato da RENTRI. Tutti i token (client_assertion e Agid-JWT-Signature) sono
 * JWS compatti firmati con il certificato X.509 dell'operatore, con la catena
 * certificati nel claim di header `x5c` (INTEGRITY_REST_02 / ID_AUTH_REST).
 */

/**
 * Estrae la rappresentazione `x5c` (array di DER base64, senza intestazioni PEM)
 * da uno o più certificati in formato PEM concatenati. È esattamente il
 * contenuto base64 tra gli header `-----BEGIN/END CERTIFICATE-----`.
 */
export function pemChainToX5c(certificatePem: string): string[] {
  const matches = certificatePem.match(
    /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g
  )
  if (!matches || matches.length === 0) {
    throw new Error('RENTRI: certificato PEM non valido (nessun blocco CERTIFICATE)')
  }
  return matches.map(block =>
    block
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s+/g, '')
  )
}

export interface SignJwsParams {
  payload: Record<string, unknown>
  privateKeyPem: string
  certificatePem: string
  algorithm: 'RS256' | 'ES256'
  /** Header JOSE aggiuntivi (es. `typ`). */
  header?: Record<string, unknown>
}

/**
 * Firma un payload come JWS compatto includendo `x5c` (e `typ: JWT`) negli
 * header JOSE. iat/exp vanno passati nel payload dal chiamante.
 */
export function signJws(params: SignJwsParams): string {
  const x5c = pemChainToX5c(params.certificatePem)
  return jwt.sign(params.payload, params.privateKeyPem, {
    algorithm: params.algorithm,
    header: {
      alg: params.algorithm,
      typ: 'JWT',
      x5c,
      ...params.header,
    },
  })
}
