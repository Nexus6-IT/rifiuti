import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request, Response, NextFunction } from 'express'
import * as jwt from 'jsonwebtoken'
import { TenantContext } from '../context/tenant-context'

/**
 * Tenant Context Middleware
 *
 * Popola il `TenantContext` (AsyncLocalStorage) per ogni richiesta HTTP a partire
 * dal JWT, così i repository risolvono il "tenant corrente" dal contesto e
 * l'estensione RLS (prisma) applica il filtro per tenant.
 *
 * NB: in NestJS i middleware girano PRIMA dei guard, quindi `req.user` (popolato
 * dal JwtAuthGuard/passport) NON è ancora disponibile qui. Per questo il
 * middleware decodifica direttamente il Bearer token (gli header sono accessibili
 * nel middleware). L'autenticazione "vera" resta a carico del JwtAuthGuard: se il
 * token è assente/non valido si prosegue SENZA contesto e sarà il guard della
 * rotta a rispondere 401 (le rotte pubbliche passano comunque).
 *
 * Registrato in app.module.ts via NestModule.configure() su tutte le rotte.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly jwtSecret: string

  constructor(private readonly configService: ConfigService) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || ''
  }

  use(req: Request, res: Response, next: NextFunction) {
    const payload = this.decodeToken(req)

    // Nessun token valido (rotta pubblica o richiesta non autenticata): si
    // prosegue senza contesto; il JwtAuthGuard della rotta gestira' l'eventuale 401.
    if (!payload) {
      return next()
    }

    // Il SUPER_ADMIN è un amministratore di piattaforma: ricavato SOLO dal ruolo
    // verificato nel token, mai da un header.
    const isSuperAdmin = payload.role === 'SUPER_ADMIN'

    // Un SUPER_ADMIN può operare su uno specifico tenant via header `X-Tenant-ID`.
    // Per gli utenti normali l'header è IGNORATO (fail-closed): vale il tenant del JWT.
    const headerTenantId = this.readTenantHeader(req)

    let tenantId: string | undefined
    if (isSuperAdmin) {
      tenantId = headerTenantId ?? payload.tenantId ?? undefined
      if (!tenantId) tenantId = undefined // '' → undefined (no filtro RLS non valido)
    } else {
      tenantId = payload.tenantId || undefined
    }

    ;(req as any).tenantId = tenantId
    ;(req as any).isSuperAdmin = isSuperAdmin

    TenantContext.run({ tenantId, userId: payload.sub, isSuperAdmin }, () => next())
  }

  /**
   * Estrae e verifica il Bearer token. Ritorna il payload ({sub, tenantId, role})
   * oppure null se assente/non valido (in tal caso il guard gestira' la 401).
   */
  private decodeToken(req: Request): { sub?: string; tenantId?: string; role?: string } | null {
    const auth = req.headers['authorization']
    if (!auth || !auth.startsWith('Bearer ') || !this.jwtSecret) {
      return null
    }
    const token = auth.slice(7)
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as Record<string, unknown>
      if (decoded && decoded['type'] === 'access') {
        return {
          sub: decoded['sub'] as string | undefined,
          tenantId: decoded['tenantId'] as string | undefined,
          role: decoded['role'] as string | undefined,
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Legge l'header `X-Tenant-ID` (case-insensitive) come scelta del tenant
   * target per un SUPER_ADMIN. Ritorna `undefined` se assente o vuoto.
   * Express normalizza i nomi degli header in minuscolo; gestiamo anche il caso
   * in cui arrivi come array (header ripetuto) prendendo il primo valore.
   */
  private readTenantHeader(req: Request): string | undefined {
    const raw = req.headers['x-tenant-id']
    const value = Array.isArray(raw) ? raw[0] : raw
    const trimmed = typeof value === 'string' ? value.trim() : ''
    return trimmed.length > 0 ? trimmed : undefined
  }
}

/**
 * Decorator to extract tenant ID from request
 *
 * Usage in controllers:
 * ```typescript
 * @Get()
 * async getFIRs(@TenantId() tenantId: string) {
 *   // tenantId is automatically extracted from request
 * }
 * ```
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export const TenantId = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest()
  const tenantId = request.tenantId

  if (!tenantId) {
    throw new UnauthorizedException('Tenant ID not found in request context')
  }

  return tenantId
})

/**
 * Decorator to extract user ID from request
 *
 * Usage in controllers:
 * ```typescript
 * @Post()
 * async createFIR(@UserId() userId: string, @Body() dto: CreateFIRDto) {
 *   // userId is automatically extracted from authenticated user
 * }
 * ```
 */
export const UserId = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest()
  const user = request.user

  if (!user || !user.userId) {
    throw new UnauthorizedException('User ID not found in request context')
  }

  return user.userId
})

/**
 * Decorator to extract full user from request
 *
 * Usage in controllers:
 * ```typescript
 * @Get('profile')
 * async getProfile(@CurrentUser() user: AuthenticatedUser) {
 *   // Full user object from JWT token
 * }
 * ```
 */
export interface AuthenticatedUser {
  userId: string
  tenantId: string
  fiscalCode: string
  email: string
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER'
  keycloakId: string
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user

    if (!user) {
      throw new UnauthorizedException('User not authenticated')
    }

    return {
      userId: user.userId,
      tenantId: user.tenantId,
      fiscalCode: user.fiscalCode,
      email: user.email,
      role: user.role,
      keycloakId: user.keycloakId,
    }
  }
)
