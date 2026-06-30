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
  /** Presente solo se la sessione e' un'impersonificazione (id del SUPER_ADMIN). */
  impersonatorId?: string
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
    // Un SUPER_ADMIN (amministratore di piattaforma) può non avere un tenant
    // proprio: in tal caso `tenantId` resta vuoto e il TenantContextMiddleware
    // lo gestisce come operatività cross-tenant (o sul tenant scelto via
    // header `X-Tenant-ID`).
    const tenantId = user.tenantId || ''
    const role = user.role || 'VIEWER'

    // 3. Resolve the effective RBAC permissions from the user's active role
    // assignments. The PermissionGuard remains the authoritative enforcement
    // point (cache-first + DB fallback); resolving here keeps `user.permissions`
    // accurate for any consumer that reads it off the request (e.g. the rate
    // limiter's admin bypass) instead of an empty placeholder.
    // Senza un tenant (es. SUPER_ADMIN cross-tenant) non si risolvono permessi
    // tenant-scoped: il flusso prosegue con un array vuoto, senza rompersi.
    const permissions = tenantId ? await this.resolvePermissions(user.id, tenantId) : []

    return {
      id: user.id,
      email: user.email,
      fiscalCode: user.fiscalCode || undefined,
      tenantId,
      role,
      permissions,
      impersonatorId: payload.impersonatorId,
    }
  }

  /**
   * Resolve the user's effective permission strings (`resource:action:scope`)
   * from all active (non-expired) role assignments in the tenant.
   *
   * A single query with nested includes; de-duplicated because a user may hold
   * the same permission through several roles. Mirrors the resolution performed
   * by PermissionGuard.loadPermissionsFromDb so the formats stay identical.
   */
  private async resolvePermissions(userId: string, tenantId: string): Promise<string[]> {
    const assignments = await this.prismaService.userRoleAssignment.findMany({
      where: {
        userId,
        tenantId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        role: {
          select: {
            permissions: {
              select: {
                permission: {
                  select: { resource: true, action: true, scope: true },
                },
              },
            },
          },
        },
      },
    })

    const permissions = new Set<string>()
    for (const assignment of assignments) {
      for (const rolePermission of assignment.role.permissions) {
        const { resource, action, scope } = rolePermission.permission
        permissions.add(`${resource}:${action}:${scope}`)
      }
    }

    return Array.from(permissions)
  }
}
