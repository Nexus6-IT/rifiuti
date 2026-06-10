import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { randomUUID } from 'crypto'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { signJws } from './rentri-jws.util'

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

interface CachedToken {
  token: string
  expiresAt: number // epoch ms
}

/**
 * Autenticazione RENTRI secondo il Modello di Interoperabilità AgID
 * (OAuth2 grant `client_credentials` con `client_assertion`):
 *
 * 1. si risolve la credenziale del TENANT corrente (certificato per-tenant, con
 *    fallback env) e si costruisce una JWT assertion firmata X.509 (header
 *    `x5c`), con claim iss/sub = client_id, aud = token endpoint, jti, iat, exp;
 * 2. la si invia al token endpoint come `client_assertion` → access token Bearer;
 * 3. il token è in cache **per client_id** (= per tenant): fondamentale per non
 *    riusare il token di un tenant per un altro.
 */
@Injectable()
export class RentriAuthService {
  // Cache token per client_id (per-tenant). MAI un singolo token condiviso.
  private readonly tokenCache = new Map<string, CachedToken>()

  constructor(
    private readonly http: HttpService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly credentialResolver: RentriCredentialResolver,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('RentriAuthService')
  }

  /** Restituisce un access token valido per il tenant corrente (cache per client_id). */
  async getAccessToken(): Promise<string> {
    const cred = await this.credentialResolver.resolve()
    const now = Date.now()

    const cached = this.tokenCache.get(cred.clientId)
    // Margine di 30s per evitare di usare un token in scadenza imminente.
    if (cached && now < cached.expiresAt - 30_000) {
      return cached.token
    }

    const assertion = this.buildClientAssertion(cred)

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cred.clientId,
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: assertion,
    })

    const response = await firstValueFrom(
      this.http.post(this.config.tokenUrl, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }),
    )

    const accessToken: string = response.data.access_token
    const expiresIn: number = Number(response.data.expires_in) || this.config.jwtTtlSeconds

    if (!accessToken) {
      throw new Error('RENTRI: token endpoint non ha restituito access_token')
    }

    this.tokenCache.set(cred.clientId, {
      token: accessToken,
      expiresAt: now + expiresIn * 1000,
    })
    this.logger.debug(
      `Access token RENTRI ottenuto per client ${cred.clientId} (source=${cred.source}, scade tra ${expiresIn}s)`,
    )

    return accessToken
  }

  /**
   * Invalida la cache dei token (es. dopo un 401). Svuota l'intera cache: è
   * un evento raro e così si evita di dover risolvere il tenant in modo sincrono.
   */
  invalidate(): void {
    this.tokenCache.clear()
  }

  /** Costruisce la client_assertion JWT firmata con il certificato del tenant. */
  private buildClientAssertion(cred: {
    clientId: string
    certificatePem: string
    privateKeyPem: string
    algorithm: 'RS256' | 'ES256'
  }): string {
    const now = Math.floor(Date.now() / 1000)
    return signJws({
      payload: {
        iss: cred.clientId,
        sub: cred.clientId,
        aud: this.config.tokenAudience,
        jti: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + this.config.jwtTtlSeconds,
      },
      privateKeyPem: cred.privateKeyPem,
      certificatePem: cred.certificatePem,
      algorithm: cred.algorithm,
    })
  }
}
