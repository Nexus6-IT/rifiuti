/**
 * JWT Strategy
 * Passport strategy for validating JWT access tokens
 */

import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { createHash } from 'node:crypto'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { TenantContext } from '../../core/context/tenant-context'
import { RedisService } from '../services/redis.service'
import { JwtPayload } from '../services/jwt-tokens.service'

export interface CurrentUserPayload {
  id: string
  email: string
  fiscalCode?: string
  tenantId: string
  role: string
  permissions: string[]
  /**
   * Identificativo di sessione per l'audit: hash di `sub` e `iat` del token (nessun segreto nel
   * valore). Cambia a ogni login, resta uguale per i token della stessa emissione.
   */
  sessionId?: string
  /** Presente solo se la sessione e' un'impersonificazione (id del SUPER_ADMIN). */
  impersonatorId?: string
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly redisService: RedisService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      passReqToCallback: true,
    })
  }

  /**
   * Valida il payload del JWT e lo arricchisce con i dati utente dal database.
   *
   * La lista di revoca va consultata QUI: e' l'unico punto attraversato da
   * ogni richiesta autenticata. Senza questo controllo il logout scrive la
   * revoca ma nessuno la legge, e il token resta valido fino a scadenza.
   */
  async validate(req: Request, payload: JwtPayload): Promise<CurrentUserPayload> {
    // 0. Un token nella lista di revoca (es. dopo logout) non deve nemmeno
    // arrivare a interrogare il database: si rifiuta subito.
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req)

    if (token && (await this.redisService.isAccessTokenRevoked(token))) {
      throw new UnauthorizedException('Token revocato')
    }

    // 0bis. Sessione singola: un token emesso PRIMA dell'ultimo accesso
    // dell'utente (epoca di sessione) appartiene a una sessione superata da
    // un login successivo. Senza questo controllo l'access token resterebbe
    // valido fino alla sua scadenza naturale (15 minuti) anche dopo che
    // l'utente ha effettuato un nuovo accesso altrove.
    const epoca = await this.redisService.leggiEpocaSessione(payload.sub)
    if (epoca !== null && typeof payload.iat === 'number' && payload.iat < epoca) {
      throw new UnauthorizedException("Sessione superata da un accesso piu' recente")
    }

    // 1. Fetch user from database
    // Client di sistema: lo store porta l'azienda dell'header X-Tenant-ID (super admin), non quella
    // dell'utente, che qui non è ancora nota.
    const user = await this.sistema.user.findUnique({
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
    // Nel contesto dell'azienda dell'utente: dopo un cambio azienda lo store porta quella scelta.
    const permissions = tenantId
      ? await TenantContext.run(
          { tenantId },
          async () => await this.resolvePermissions(user.id, tenantId)
        )
      : []

    return {
      id: user.id,
      email: user.email,
      fiscalCode: user.fiscalCode || undefined,
      tenantId,
      role,
      permissions,
      impersonatorId: payload.impersonatorId,
      sessionId: createHash('sha256')
        .update(`${payload.sub}:${payload.iat ?? ''}`)
        .digest('hex')
        .slice(0, 32),
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
