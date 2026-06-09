import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { randomUUID } from 'crypto'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { signJws } from './rentri-jws.util'

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

/**
 * Autenticazione RENTRI secondo il Modello di Interoperabilità AgID
 * (OAuth2 grant `client_credentials` con `client_assertion`):
 *
 * 1. si costruisce una JWT assertion firmata con il certificato X.509
 *    dell'operatore (header `x5c`), con claim iss/sub = client_id, aud = token
 *    endpoint, jti, iat, exp;
 * 2. la si invia al token endpoint come `client_assertion` →
 *    si ottiene un access token Bearer da usare nelle chiamate API;
 * 3. il token viene messo in cache fino a poco prima della scadenza.
 */
@Injectable()
export class RentriAuthService {
  private cachedToken: string | null = null
  private tokenExpiresAt = 0 // epoch ms

  constructor(
    private readonly http: HttpService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('RentriAuthService')
  }

  /** Restituisce un access token valido, riusando la cache quando possibile. */
  async getAccessToken(): Promise<string> {
    const now = Date.now()
    // Margine di 30s per evitare di usare un token in scadenza imminente.
    if (this.cachedToken && now < this.tokenExpiresAt - 30_000) {
      return this.cachedToken
    }

    const assertion = this.buildClientAssertion()

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
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

    this.cachedToken = accessToken
    this.tokenExpiresAt = now + expiresIn * 1000
    this.logger.debug(`Access token RENTRI ottenuto (scade tra ${expiresIn}s)`)

    return accessToken
  }

  /** Invalida la cache del token (es. dopo un 401). */
  invalidate(): void {
    this.cachedToken = null
    this.tokenExpiresAt = 0
  }

  /** Costruisce la client_assertion JWT firmata X.509. */
  private buildClientAssertion(): string {
    const now = Math.floor(Date.now() / 1000)
    return signJws({
      payload: {
        iss: this.config.clientId,
        sub: this.config.clientId,
        aud: this.config.tokenAudience,
        jti: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + this.config.jwtTtlSeconds,
      },
      privateKeyPem: this.config.privateKeyPem,
      certificatePem: this.config.certificatePem,
      algorithm: this.config.algorithm,
    })
  }
}
