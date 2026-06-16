import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext } from '../context/tenant-context';

/**
 * Tenant Context Middleware
 *
 * Extracts tenant ID from authenticated user's JWT token
 * and attaches it to the request object for downstream use.
 *
 * This middleware is CRITICAL for multi-tenant data isolation.
 * It must run AFTER authentication middleware.
 *
 * Usage in app.module.ts:
 * ```typescript
 * export class AppModule implements NestModule {
 *   configure(consumer: MiddlewareConsumer) {
 *     consumer
 *       .apply(TenantContextMiddleware)
 *       .forRoutes('*');
 *   }
 * }
 * ```
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Skip tenant isolation for public routes
    const publicRoutes = ['/health', '/metrics', '/auth/login', '/auth/register'];
    if (publicRoutes.some(route => req.path.startsWith(route))) {
      return next();
    }

    // Extract tenant ID from authenticated user
    // Keycloak JWT contains user info in req.user
    const user = (req as any).user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    // Il SUPER_ADMIN è un amministratore di piattaforma: lo ricaviamo SOLO dal
    // ruolo verificato nel token, mai da un header (security: il bypass tenant
    // non deve essere inferibile da utenti normali).
    const isSuperAdmin = user.role === 'SUPER_ADMIN';

    // Un SUPER_ADMIN può scegliere di operare su uno specifico tenant passando
    // l'header `X-Tenant-ID`. Per gli utenti normali l'header viene IGNORATO:
    // il tenant è sempre e solo quello del loro JWT (fail-closed).
    const headerTenantId = this.readTenantHeader(req);

    let tenantId: string | undefined;

    if (isSuperAdmin) {
      // Super admin: usa il tenant target se indicato, altrimenti opera
      // cross-tenant (nessun vincolo di tenant → RLS bypassata a valle).
      tenantId = headerTenantId ?? user.tenantId ?? undefined;
      // Un tenantId vuoto ('') va normalizzato a undefined per evitare di
      // attivare il filtro RLS con un valore non valido.
      if (!tenantId) {
        tenantId = undefined;
      }
    } else {
      // Utente normale: deve avere un tenant nel token (invariato).
      if (!user.tenantId) {
        throw new UnauthorizedException('Tenant ID not found in user token');
      }
      tenantId = user.tenantId;
    }

    // Attach tenant ID to request for downstream use (undefined per super admin
    // cross-tenant).
    (req as any).tenantId = tenantId;
    (req as any).isSuperAdmin = isSuperAdmin;

    // Esegue il resto della richiesta DENTRO il TenantContext (AsyncLocalStorage):
    // così i repository risolvono il tenant corrente dal contesto, senza il
    // fallback al "primo tenant" che causava il cross-tenant data leak.
    TenantContext.run(
      { tenantId, userId: user.id ?? user.userId, isSuperAdmin },
      () => next(),
    );
  }

  /**
   * Legge l'header `X-Tenant-ID` (case-insensitive) come scelta del tenant
   * target per un SUPER_ADMIN. Ritorna `undefined` se assente o vuoto.
   * Express normalizza i nomi degli header in minuscolo; gestiamo anche il caso
   * in cui arrivi come array (header ripetuto) prendendo il primo valore.
   */
  private readTenantHeader(req: Request): string | undefined {
    const raw = req.headers['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : undefined;
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
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const TenantId = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const tenantId = request.tenantId;

  if (!tenantId) {
    throw new UnauthorizedException('Tenant ID not found in request context');
  }

  return tenantId;
});

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
  const request = ctx.switchToHttp().getRequest();
  const user = request.user;

  if (!user || !user.userId) {
    throw new UnauthorizedException('User ID not found in request context');
  }

  return user.userId;
});

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
  userId: string;
  tenantId: string;
  fiscalCode: string;
  email: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  keycloakId: string;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return {
      userId: user.userId,
      tenantId: user.tenantId,
      fiscalCode: user.fiscalCode,
      email: user.email,
      role: user.role,
      keycloakId: user.keycloakId,
    };
  },
);
