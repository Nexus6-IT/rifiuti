import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../../core/logger/logger.service'
import { UserRepository } from '../persistence/user.repository'

/**
 * JWT Strategy
 *
 * Passport.js strategy for validating JWT access tokens.
 * Used for protecting API endpoints.
 *
 * Flow:
 * 1. Extract JWT from Authorization header
 * 2. Verify JWT signature and expiry
 * 3. Extract user ID from payload
 * 4. Load user from database
 * 5. Attach user to request object
 *
 * JWT Payload includes:
 * - sub: User ID
 * - fiscalCode: Italian fiscal code
 * - email: User email
 * - tenantId: User's primary tenant
 * - roles: User roles array
 * - spidLevel: SPID authentication level (0-3)
 * - canSignDocuments: Boolean flag
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly userRepository: UserRepository
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    })

    this.logger.setContext('JwtStrategy')
  }

  /**
   * Validate JWT payload and load user
   *
   * Called automatically by Passport when JWT is valid
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    this.logger.debug('Validating JWT payload', {
      userId: payload.sub,
      tenantId: payload.tenantId,
    })

    try {
      // Extract user ID from payload
      const userId = payload.sub

      // Load user from database
      const user = await this.userRepository.findById(userId)

      if (!user) {
        this.logger.warn('User not found for JWT', { userId })
        throw new UnauthorizedException('User not found')
      }

      // Check if user is active
      if (!user.getIsActive()) {
        this.logger.warn('Inactive user attempted access', { userId })
        throw new UnauthorizedException('User account is inactive')
      }

      this.logger.debug('JWT validation successful', {
        userId,
        fiscalCode: user.getFiscalCode(),
        tenantId: user.getTenantId(),
      })

      // Return authenticated user object
      // This will be attached to request.user by Passport
      return {
        id: user.getId(),
        fiscalCode: user.getFiscalCode(),
        firstName: user.getFirstName(),
        lastName: user.getLastName(),
        email: user.getEmail(),
        tenantId: user.getTenantId(),
        roles: user.getRoles(),
        spidLevel: user.getSpidLevel(),
        canSignDocuments: user.canSignDocuments(),
        isActive: user.getIsActive(),
      }
    } catch (error: any) {
      this.logger.error('JWT validation failed', error, {
        userId: payload.sub,
      })

      if (error instanceof UnauthorizedException) {
        throw error
      }

      throw new UnauthorizedException('Invalid token')
    }
  }
}

/**
 * JWT Payload Interface
 *
 * Structure of data encoded in JWT access token
 */
export interface JwtPayload {
  sub: string // User ID
  fiscalCode: string
  email: string
  tenantId: string
  roles: string[]
  spidLevel: number
  canSignDocuments: boolean
  iat?: number // Issued at (timestamp)
  exp?: number // Expiration (timestamp)
}

/**
 * Authenticated User Interface
 *
 * User object attached to request after JWT validation
 */
export interface AuthenticatedUser {
  id: string
  fiscalCode: string
  firstName: string
  lastName: string
  email: string
  tenantId: string
  roles: string[]
  spidLevel: number
  canSignDocuments: boolean
  isActive: boolean
}
