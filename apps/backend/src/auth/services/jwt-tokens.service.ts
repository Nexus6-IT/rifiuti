/**
 * JWT Tokens Service
 * Handles generation and validation of access and refresh tokens
 */

import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'

export interface JwtPayload {
  sub: string // userId
  email?: string
  fiscalCode?: string
  tenantId?: string
  role?: string
  type: 'access' | 'refresh'
  iat?: number
  exp?: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number // seconds
}

export interface UserTokenPayload {
  id: string
  email: string
  fiscalCode?: string
  tenantId: string
  role: string
}

@Injectable()
export class JwtTokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Generate access token (short-lived, 15min)
   */
  generateAccessToken(user: UserTokenPayload): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      fiscalCode: user.fiscalCode,
      tenantId: user.tenantId,
      role: user.role,
      type: 'access',
    }

    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION', '15m'),
    })
  }

  /**
   * Generate refresh token (long-lived, 7 days)
   */
  generateRefreshToken(userId: string): string {
    const payload: JwtPayload = {
      sub: userId,
      type: 'refresh',
    }

    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION', '7d'),
    })
  }

  /**
   * Generate both access and refresh tokens
   */
  generateTokenPair(user: UserTokenPayload): TokenPair {
    const accessToken = this.generateAccessToken(user)
    const refreshToken = this.generateRefreshToken(user.id)

    // Parse expiration time to seconds
    const expiresIn = this.parseExpirationToSeconds(
      this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION', '15m')
    )

    return {
      accessToken,
      refreshToken,
      expiresIn,
    }
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token: string): JwtPayload | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token)
      if (payload.type !== 'access') {
        return null
      }
      return payload
    } catch (error) {
      return null
    }
  }

  /**
   * Verify and decode refresh token
   */
  verifyRefreshToken(token: string): JwtPayload | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token)
      if (payload.type !== 'refresh') {
        return null
      }
      return payload
    } catch (error) {
      return null
    }
  }

  /**
   * Decode token without verification (for debugging)
   */
  decodeToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.verify<JwtPayload>(token, { ignoreExpiration: true })
    } catch (error) {
      return null
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null
    }

    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null
    }

    return parts[1]
  }

  /**
   * Parse expiration string (e.g., "15m", "7d") to seconds
   */
  private parseExpirationToSeconds(expiration: string): number {
    const unit = expiration.slice(-1)
    const value = parseInt(expiration.slice(0, -1), 10)

    switch (unit) {
      case 's':
        return value
      case 'm':
        return value * 60
      case 'h':
        return value * 60 * 60
      case 'd':
        return value * 60 * 60 * 24
      default:
        return 900 // 15 minutes default
    }
  }
}
