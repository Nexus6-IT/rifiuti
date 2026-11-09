/**
 * Dev Auth Controller
 * ONLY FOR DEVELOPMENT - Bypass SPID authentication
 *
 * Difesa in profondità (2026-07-25): oltre al check runtime su NODE_ENV,
 * questo controller viene registrato in AuthModule SOLO quando
 * `NODE_ENV !== 'production'` (vedi `auth.module.ts`), quindi in produzione
 * la rotta `POST /auth/dev/login` non esiste proprio — non basta più che una
 * variabile d'ambiente sia impostata correttamente a runtime.
 */

import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { ConfigService } from '@nestjs/config'
import { Public } from '../decorators/public.decorator'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { DevLoginDto } from '../dto/dev-login.dto'
import { ConsentiSelezioneNonValida } from '../../core/decorators/consenti-selezione-non-valida.decorator'

// Login di sviluppo: come la sessione, non dipende dall'azienda selezionata.
// Senza throttler: gli e2e fanno un dev-login per utente e il limite globale (100/min per IP)
// li farebbe fallire a caso. Il controller non e' montato in produzione (vedi `auth.module.ts`).
@SkipThrottle()
@ConsentiSelezioneNonValida()
@Controller('auth')
export class DevAuthController {
  constructor(
    private readonly jwtTokensService: JwtTokensService,
    private readonly redisService: RedisService,
    // Client di sistema: il login (solo sviluppo) cerca l'utente prima di conoscerne l'azienda.
    private readonly sistema: PrismaSistemaService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Dev login endpoint
   * ONLY FOR DEVELOPMENT - Bypass SPID authentication
   */
  @Post('dev/login')
  @Public()
  async devLogin(@Body() dto: DevLoginDto) {
    // Only allow in development
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development')
    if (nodeEnv === 'production') {
      throw new UnauthorizedException('Dev login not available in production')
    }

    // Find user by email (email is not unique in schema, so use findFirst)
    // Client di sistema: nessuna azienda nel contesto al login.
    const user = await this.sistema.user.findFirst({
      where: { email: dto.email },
      include: {
        tenant: true,
      },
    })

    const isNewUser = false

    if (!user) {
      // Create new user - requires a tenant ID
      // In dev mode, we need to create or use a default tenant
      throw new UnauthorizedException(
        'Dev login requires existing user with tenant. Please create user first.'
      )
    }

    // Get tenant and role (User has direct tenantId)
    // azienda primaria: record utente letto dal DB, con cui si emette il token (login)
    const tenantId = user.tenantId || ''
    const role = user.role || 'VIEWER'

    // Generate JWT token pair
    const tokens = this.jwtTokensService.generateTokenPair({
      id: user.id,
      email: user.email,
      fiscalCode: user.fiscalCode || undefined,
      tenantId,
      role,
    })

    // Store refresh token in Redis (7 days TTL)
    await this.redisService.storeRefreshToken(
      user.id,
      tokens.refreshToken,
      7 * 24 * 60 * 60 // 7 days in seconds
    )

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: {
        id: user.id,
        email: user.email,
        fiscalCode: user.fiscalCode,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      isNewUser,
    }
  }
}
