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
} from '@nestjs/common'
import { Response } from 'express'
import { AuthGuard } from '@nestjs/passport'
import { JwtAuthGuard } from '../guards/jwt-auth.guard'
import { Public } from '../decorators/public.decorator'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RefreshTokenDto } from '../dto/refresh-token.dto'
import { LogoutDto } from '../dto/logout.dto'
import { DevLoginDto } from '../dto/dev-login.dto'
import { ConfigService } from '@nestjs/config'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwtTokensService: JwtTokensService,
    private readonly redisService: RedisService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService
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
    const user = await this.prismaService.user.findUnique({
      where: { id: spidUser.id },
      include: {
        tenant: true, // User belongs to one tenant (not tenants)
      },
    })

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    // Get tenant and role (User schema has single tenant relationship)
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
    const user = await this.prismaService.user.findFirst({
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
    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
      include: {
        tenant: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    // Get tenant and role
    const tenantId = user.tenantId || ''
    const role = user.role || 'VIEWER'

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
