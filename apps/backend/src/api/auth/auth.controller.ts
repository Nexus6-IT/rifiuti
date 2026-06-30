import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { AuthGuard } from '@nestjs/passport'
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard'
import { UserId } from '../../core/decorators/user.decorator'
import { LoggerService } from '../../core/logger/logger.service'
import { RefreshTokenUseCase } from '../../application/auth/refresh-token.use-case'
import { GetSessionInfoUseCase } from '../../application/auth/get-session-info.use-case'
import { CheckSpidAuthStatusUseCase } from '../../application/auth/check-spid-auth-status.use-case'
import {
  RefreshTokenDto,
  LoginResponseDto,
  SessionInfoDto,
  SpidAuthStatusDto,
} from './dto/auth.dto'

/**
 * Authentication Controller
 *
 * Handles SPID/CIE authentication flow via Keycloak SAML.
 *
 * Endpoints:
 * - GET /auth/login - Initiate SPID login (redirect to Keycloak)
 * - POST /auth/callback - SAML callback from Keycloak
 * - POST /auth/refresh - Refresh access token
 * - POST /auth/logout - Logout and invalidate session
 * - GET /auth/session - Get current session info
 * - GET /auth/spid-status - Get SPID authentication status
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly getSessionInfoUseCase: GetSessionInfoUseCase,
    private readonly checkSpidAuthStatusUseCase: CheckSpidAuthStatusUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AuthController')
  }

  /**
   * Initiate SPID/CIE login
   * Redirects to Keycloak SAML endpoint
   */
  @Get('login')
  @UseGuards(AuthGuard('saml'))
  @ApiOperation({
    summary: 'Initiate SPID/CIE login',
    description: 'Redirects to Keycloak for SAML authentication with SPID or CIE',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to Keycloak SAML endpoint',
  })
  async login(
    @Res() res: Response,
    @Query('provider') provider: string = 'spid',
    @Query('returnUrl') returnUrl?: string
  ): Promise<void> {
    this.logger.info('Login request received', { provider, returnUrl })

    // Passport SAML strategy will handle the redirect
    // This method exists just to trigger the strategy
  }

  /**
   * SAML callback from Keycloak
   * Processes SAML assertion and issues JWT tokens
   */
  @Post('callback')
  @UseGuards(AuthGuard('saml'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SAML callback',
    description: 'Receives SAML assertion from Keycloak and issues JWT tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid SAML assertion',
  })
  async callback(@Req() req: Request): Promise<LoginResponseDto> {
    this.logger.info('SAML callback received')

    // User and tokens are attached by SAML strategy
    const result = (req as any).user

    if (!result) {
      throw new UnauthorizedException('SAML authentication failed')
    }

    this.logger.info('SAML callback processed successfully', {
      userId: result.user.id,
      fiscalCode: result.user.fiscalCode,
    })

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    }
  }

  /**
   * Refresh access token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Issues new access and refresh tokens using valid refresh token',
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
  }> {
    this.logger.info('Token refresh request received')

    const result = await this.refreshTokenUseCase.execute(dto.refreshToken)

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    }
  }

  /**
   * Logout
   * Invalidates session (client should discard tokens)
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout',
    description: 'Logs out user and invalidates session',
  })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
  })
  async logout(@UserId() userId: string): Promise<{ message: string }> {
    this.logger.info('Logout request received', { userId })

    // In a production system, you might:
    // - Add refresh token to blacklist
    // - Notify Keycloak of logout
    // - Clear server-side session if using one
    //
    // For now, client-side token disposal is sufficient
    // since JWTs are stateless

    this.logger.info('User logged out', { userId })

    return {
      message: 'Logged out successfully',
    }
  }

  /**
   * Get current session info
   */
  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get session info',
    description: 'Retrieves current user session information',
  })
  @ApiResponse({
    status: 200,
    description: 'Session info retrieved',
    type: SessionInfoDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getSession(@UserId() userId: string): Promise<SessionInfoDto> {
    this.logger.debug('Session info request', { userId })

    const sessionInfo = await this.getSessionInfoUseCase.execute(userId)

    return {
      user: sessionInfo.user,
      spid: sessionInfo.spid,
      authorization: sessionInfo.authorization,
      session: sessionInfo.session,
    }
  }

  /**
   * Get SPID authentication status
   */
  @Get('spid-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get SPID authentication status',
    description: 'Checks if user can sign documents based on SPID level and auth freshness',
  })
  @ApiResponse({
    status: 200,
    description: 'SPID status retrieved',
    type: SpidAuthStatusDto,
  })
  async getSpidStatus(@UserId() userId: string): Promise<SpidAuthStatusDto> {
    this.logger.debug('SPID status request', { userId })

    const status = await this.checkSpidAuthStatusUseCase.execute(userId)

    return {
      hasSpidAuth: status.hasSpidAuth,
      spidLevel: status.spidLevel,
      isAuthRecent: status.isAuthRecent,
      canSignDocuments: status.canSignDocuments,
      reason: status.reason,
      message: status.message,
      requiresReAuth: status.requiresReAuth,
      requiresLevelUpgrade: status.requiresLevelUpgrade,
      issuer: status.issuer,
      sessionId: status.sessionId,
      authenticatedAt: status.authenticatedAt,
      authExpiresAt: status.authExpiresAt,
      minutesRemaining: status.minutesRemaining,
      warningThreshold: status.warningThreshold,
    }
  }
}
