/**
 * Auth Controller
 * Handles authentication endpoints (SPID login, token refresh, logout)
 */

import {
  Controller,
  Get,
  Post,
  UseGuards,
  Request,
  Res,
  Body,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Response } from 'express'
import { AuthGuard } from '@nestjs/passport'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { Public } from '../decorators/public.decorator'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { RefreshTokenDto } from '../dto/refresh-token.dto'
import { LogoutDto } from '../dto/logout.dto'
import { ConfigService } from '@nestjs/config'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import {
  AZIENDA_SELEZIONATA_NON_ACCESSIBILE,
  VERIFICA_AZIENDA_NON_DISPONIBILE,
} from '../../core/context/azienda-selezionata-errori'
import { ConsentiSelezioneNonValida } from '../../core/decorators/consenti-selezione-non-valida.decorator'

// Sessione (login, refresh, logout, profilo): non dipende dall'azienda selezionata e deve
// funzionare anche con una selezione non più valida, altrimenti l'utente resta bloccato.
@ConsentiSelezioneNonValida()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwtTokensService: JwtTokensService,
    private readonly redisService: RedisService,
    // Client di sistema: spid/callback e refresh cercano l'utente prima di conoscerne l'azienda.
    private readonly sistema: PrismaSistemaService,
    private readonly configService: ConfigService,
    private readonly ruoloEffettivo: RuoloEffettivoService
  ) {}

  /**
   * Initiate SPID login
   * Redirects to SPID Identity Provider
   */
  @Get('spid/login')
  @Public()
  @UseGuards(AuthGuard('spid'))
  spidLogin() {
    // Passport will handle the redirect to SPID IdP
  }

  /**
   * SPID callback endpoint
   * Receives SAML response and generates JWT tokens
   */
  // Keycloak invia la SAMLResponse via binding HTTP-POST all'ACS.
  @Post('spid/callback')
  @Public()
  @UseGuards(AuthGuard('spid'))
  async spidCallback(@Request() req: any, @Res() res: Response) {
    const spidUser = req.user

    // Fetch user with tenant information
    // Client di sistema: il callback SAML arriva senza contesto azienda.
    const user = await this.sistema.user.findUnique({
      where: { id: spidUser.id },
      include: {
        tenant: true, // User belongs to one tenant (not tenants)
      },
    })

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    // Get tenant and role (User schema has single tenant relationship)
    // azienda primaria: record utente letto dal DB, con cui si emette il token (login)
    const tenantId = user.tenantId || ''
    const role = user.role || 'VIEWER'

    // Generate JWT token pair
    const tokens = this.jwtTokensService.generateTokenPair({
      id: spidUser.id,
      email: spidUser.email,
      fiscalCode: spidUser.fiscalCode,
      tenantId,
      role,
    })

    // Sessione singola (regola trasversale): un nuovo accesso invalida il
    // precedente. Si revocano i refresh token gia' emessi e si sposta in
    // avanti l'epoca di sessione, che rende non validi anche gli access
    // token ancora vivi della sessione precedente.
    await this.redisService.revokeAllRefreshTokens(spidUser.id)
    await this.redisService.impostaEpocaSessione(spidUser.id)

    // Store refresh token in Redis (7 days TTL)
    await this.redisService.storeRefreshToken(
      spidUser.id,
      tokens.refreshToken,
      7 * 24 * 60 * 60 // 7 days in seconds
    )

    // Il callback SAML e' una navigazione del browser: si reindirizza alla SPA
    // passando i token nel fragment (#) per non finire in log/referer lato server.
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'https://rifiuti.ignicraft.com'
    const fragment = new URLSearchParams({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: String(tokens.expiresIn),
    }).toString()
    return res.redirect(302, `${frontendUrl}/auth/callback#${fragment}`)
  }

  /**
   * Refresh access token using refresh token
   */
  @Post('refresh')
  @Public()
  async refresh(@Body() dto: RefreshTokenDto) {
    // Verify refresh token
    const payload = this.jwtTokensService.verifyRefreshToken(dto.refreshToken)
    if (!payload) {
      throw new UnauthorizedException('Invalid refresh token')
    }

    // Check if refresh token is valid in Redis
    const isValid = await this.redisService.isRefreshTokenValid(payload.sub, dto.refreshToken)
    if (!isValid) {
      throw new UnauthorizedException('Refresh token has been revoked')
    }

    // Fetch user with tenant information
    // Client di sistema: il refresh è pubblico, nessuna azienda nel contesto.
    const user = await this.sistema.user.findUnique({
      where: { id: payload.sub },
      include: {
        tenant: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    const role = user.role || 'VIEWER'
    // azienda primaria: record utente letto dal DB, base per ricontrollare l'accesso all'azienda del refresh
    const tenantPrimario = user.tenantId || ''
    // Azienda del token che si rinnova: quella scelta con lo switch, se il refresh token la
    // porta; altrimenti (token del login, o emessi prima di questa modifica) la primaria.
    const tenantId = payload.tenantId || tenantPrimario

    // Un'azienda diversa dalla primaria si ricontrolla a ogni refresh (associazione scaduta o
    // revocata nel frattempo), con la stessa regola dello switch. Se non è più accessibile si
    // rifiuta: mai rinnovare in silenzio sull'azienda primaria, dove una richiesta ripetuta
    // dopo il refresh scriverebbe nell'azienda sbagliata. Il SUPER_ADMIN, come nello switch,
    // non ha vincoli di appartenenza.
    if (tenantId !== tenantPrimario && role !== 'SUPER_ADMIN') {
      // Un errore del database non dice niente sull'accesso: 503 come il
      // TenantSwitchInterceptor, così il frontend riprova e non cancella la selezione.
      const accesso = await this.ruoloEffettivo
        .accesso({ id: user.id, role, tenantId: tenantPrimario }, tenantId)
        .catch(() => {
          throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
        })
      if (accesso === null) {
        throw new ForbiddenException({ ...AZIENDA_SELEZIONATA_NON_ACCESSIBILE })
      }
    }

    // Generate new access token
    const accessToken = this.jwtTokensService.generateAccessToken({
      id: payload.sub,
      email: user.email,
      fiscalCode: user.fiscalCode || undefined,
      tenantId,
      role,
    })

    return {
      accessToken,
      expiresIn: 900, // 15 minutes
    }
  }

  /**
   * Logout - revoke tokens
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Request() req: any, @Body() dto: LogoutDto) {
    const userId = req.user.id

    // Revoke refresh token
    await this.redisService.revokeRefreshToken(userId, dto.refreshToken)

    // Revoke access token (if present)
    const accessToken = this.jwtTokensService.extractTokenFromHeader(req.headers.authorization)
    if (accessToken) {
      await this.redisService.revokeAccessToken(accessToken, 900) // 15 minutes TTL
    }

    return { message: 'Logged out successfully' }
  }

  /**
   * Get current user profile
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@Request() req: any) {
    return req.user
  }
}
