import { Injectable, Inject } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriCredentialService } from './rentri-credential.service'
import { signJws } from './rentri-jws.util'

/** Credenziale (certificato + chiave privata) usata per firmare il JWT self-issued. */
interface CredenzialeOperatore {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm: 'RS256' | 'ES256'
}

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
    private readonly credentialService: RentriCredentialService,
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
    const credenziale = await this.risolviCredenziale(tenantId)
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

  /**
   * Risolve la credenziale (certificato + chiave privata) da usare per la
   * firma: quella del tenant se configurata, altrimenti il fallback da env
   * (pilota single-operator / sviluppo). Lancia se nessuna delle due esiste
   * (fail-closed: senza certificato non si può firmare nulla).
   */
  private async risolviCredenziale(tenantId: string): Promise<CredenzialeOperatore> {
    if (tenantId) {
      const cred = await this.credentialService.getForTenant(tenantId)
      if (cred) {
        return {
          clientId: cred.clientId,
          certificatePem: cred.certificatePem,
          privateKeyPem: cred.privateKeyPem,
          algorithm: cred.algorithm,
        }
      }
    }

    if (this.config.certificatePem && this.config.privateKeyPem) {
      return {
        clientId: this.config.clientId,
        certificatePem: this.config.certificatePem,
        privateKeyPem: this.config.privateKeyPem,
        algorithm: this.config.algorithm,
      }
    }

    throw new Error(
      tenantId
        ? `RENTRI: nessuna credenziale per il tenant ${tenantId} e nessun fallback da env`
        : 'RENTRI: nessun tenant indicato e nessuna credenziale di fallback da env'
    )
  }
}
