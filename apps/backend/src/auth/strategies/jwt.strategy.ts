/**
 * JWT Strategy
 * Passport strategy for validating JWT access tokens
 */

import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { JwtPayload } from '../services/jwt-tokens.service'

export interface CurrentUserPayload {
  id: string
  email: string
  fiscalCode?: string
  tenantId: string
  role: string
  permissions: string[]
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    })
  }

  /**
   * Validate JWT payload and enrich with user data from database
   */
  async validate(payload: JwtPayload): Promise<CurrentUserPayload> {
    // 1. Fetch user from database
    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
    })

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    // 2. Get tenant and role (User has direct tenantId and role)
    const tenantId = user.tenantId || ''
    const role = user.role || 'VIEWER'

    // 3. Build permissions (TODO: implement RBAC permissions)
    const permissions: string[] = []

    return {
      id: user.id,
      email: user.email,
      fiscalCode: user.fiscalCode || undefined,
      tenantId,
      role,
      permissions,
    }
  }
}
