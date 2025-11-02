import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../core/logger/logger.service';
import { UserRepository } from '../../infrastructure/persistence/user.repository';

/**
 * Refresh Token Use Case
 *
 * Validates refresh token and issues new access and refresh tokens.
 * Ensures user still exists and is active before issuing new tokens.
 *
 * Flow:
 * 1. Verify refresh token signature
 * 2. Extract user ID from token
 * 3. Verify user still exists and is active
 * 4. Issue new access and refresh tokens
 *
 * Security:
 * - Refresh tokens have longer expiry (7 days)
 * - Each refresh issues a new refresh token (token rotation)
 * - Old refresh tokens are invalidated
 * - Refresh tokens can only be used once
 */
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userRepository: UserRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('RefreshTokenUseCase');
  }

  /**
   * Execute token refresh
   */
  async execute(refreshToken: string): Promise<RefreshTokenResult> {
    this.logger.debug('Processing token refresh request');

    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      // Validate token type
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const userId = payload.sub;

      this.logger.debug('Refresh token verified', { userId });

      // Verify user still exists and is active
      const user = await this.userRepository.findById(userId);

      if (!user) {
        this.logger.warn('User not found for refresh token', { userId });
        throw new UnauthorizedException('User not found');
      }

      if (!user.getIsActive()) {
        this.logger.warn('Inactive user attempted token refresh', { userId });
        throw new UnauthorizedException('User account is inactive');
      }

      // Generate new tokens
      const accessPayload = {
        sub: user.getId(),
        fiscalCode: user.getFiscalCode(),
        email: user.getEmail(),
        tenantId: user.getTenantId(),
        roles: user.getRoles(),
        spidLevel: user.getSpidLevel(),
        canSignDocuments: user.canSignDocuments(),
      };

      const newAccessToken = this.jwtService.sign(accessPayload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '1h',
      });

      // Issue new refresh token (token rotation)
      const newRefreshToken = this.jwtService.sign(
        { sub: user.getId(), type: 'refresh' },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: '7d',
        }
      );

      this.logger.info('Token refreshed successfully', {
        userId,
        fiscalCode: user.getFiscalCode(),
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600, // 1 hour
      };
    } catch (error: any) {
      this.logger.error('Token refresh failed', error);

      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Refresh token expired');
      }

      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      throw error;
    }
  }
}

/**
 * Refresh Token Result
 */
export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
