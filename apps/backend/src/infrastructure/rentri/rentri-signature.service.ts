import { Injectable, Inject } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { signJws } from './rentri-jws.util'

/**
 * Firma di integrità del messaggio secondo il pattern AgID INTEGRITY_REST_02
 * adottato da RENTRI.
 *
 * Per ogni richiesta con body si calcola il digest SHA-256 del corpo (RFC 3230)
 * e si produce un JWS nell'header HTTP `Agid-JWT-Signature` i cui claim
 * includono `signed_headers` con il digest, legando così la firma al contenuto
 * effettivamente trasmesso (anti-tampering).
 *
 * La firma usa il certificato del TENANT corrente (risolto dal resolver), così
 * ogni messaggio è firmato per conto dell'operatore giusto.
 */
@Injectable()
export class RentriSignatureService {
  constructor(
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly credentialResolver: RentriCredentialResolver,
  ) {}

  /** Nome dell'header HTTP che trasporta la firma di integrità. */
  static readonly SIGNATURE_HEADER = 'Agid-JWT-Signature'

  /**
   * Calcola il valore dell'header `Digest` (RFC 3230): `SHA-256=<base64>` del
   * digest binario SHA-256 della rappresentazione del body.
   */
  computeDigest(rawBody: string): string {
    const hash = createHash('sha256').update(rawBody, 'utf8').digest('base64')
    return `SHA-256=${hash}`
  }

  /**
   * Costruisce gli header di integrità per una richiesta con body JSON:
   * - `Digest`: digest RFC 3230 del body
   * - `Agid-JWT-Signature`: JWS che firma `signed_headers` (digest + content-type)
   *
   * Async perché risolve la credenziale del tenant corrente.
   */
  async buildIntegrityHeaders(
    rawBody: string,
    contentType = 'application/json',
  ): Promise<Record<string, string>> {
    const cred = await this.credentialResolver.resolve()
    const digest = this.computeDigest(rawBody)
    const now = Math.floor(Date.now() / 1000)

    const payload = {
      iss: cred.clientId,
      aud: this.config.signatureAudience,
      iat: now,
      nbf: now,
      exp: now + this.config.jwtTtlSeconds,
      jti: randomUUID(),
      // signed_headers: elenco di header HTTP protetti dalla firma (INTEGRITY_REST_02)
      signed_headers: [{ digest }, { 'content-type': contentType }],
    }

    const signature = signJws({
      payload,
      privateKeyPem: cred.privateKeyPem,
      certificatePem: cred.certificatePem,
      algorithm: cred.algorithm,
    })

    return {
      Digest: digest,
      [RentriSignatureService.SIGNATURE_HEADER]: signature,
    }
  }
}
