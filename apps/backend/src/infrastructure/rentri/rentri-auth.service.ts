import { Injectable, Inject } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { signJws } from './rentri-jws.util'

/**
 * Autenticazione RENTRI secondo **ID_AUTH_REST_02** (Modello di
 * Interoperabilità AgID) in *direct trust*.
 *
 * Il JWT è **self-issued**: firmato localmente con la chiave privata
 * dell'operatore, con il certificato X.509 allegato nell'header `x5c`, e
 * passato direttamente come `Authorization: Bearer`. La fiducia poggia sul
 * certificato, non su un token rilasciato dall'ente — infatti RENTRI **non
 * espone alcun endpoint `/token`**: il contratto ufficiale
 * (`docs/contracts/rentri/formulari.yaml`) dichiara in `securitySchemes`
 * unicamente lo schema `Bearer` (JWT), in nessuno dei path compare `/token`.
 *
 * Di conseguenza non c'è nulla da ottenere dall'ente e nulla da mettere in
 * cache: il token è firmato ex novo a ogni chiamata, con `jti` univoco e
 * validità breve (`RentriConfig.jwtTtlSeconds`, tipicamente 5 minuti).
 */
@Injectable()
export class RentriAuthService {
  constructor(
    private readonly credentialResolver: RentriCredentialResolver,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RentriAuthService')
  }

  /**
   * Costruisce l'header `Authorization: Bearer <jwt>` per il tenant indicato,
   * firmando un nuovo JWT self-issued (ID_AUTH_REST_02) a ogni chiamata.
   */
  async creaAuthorizationHeader(tenantId: string): Promise<string> {
    const credenziale = await this.credentialResolver.resolve(tenantId)
    const now = Math.floor(Date.now() / 1000)

    const token = signJws({
      payload: {
        iss: credenziale.clientId,
        sub: credenziale.clientId,
        aud: this.config.audience,
        jti: randomUUID(),
        iat: now,
        exp: now + this.config.jwtTtlSeconds,
      },
      privateKeyPem: credenziale.privateKeyPem,
      certificatePem: credenziale.certificatePem,
      algorithm: credenziale.algorithm,
    })

    this.logger.debug(
      `JWT RENTRI self-issued firmato per ${tenantId ? `tenant ${tenantId}` : 'fallback env'} (operatore ${credenziale.clientId})`
    )

    return `Bearer ${token}`
  }
}
