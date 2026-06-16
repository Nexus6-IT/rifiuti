import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';

/**
 * TenantIsolationGuard
 * Validates tenant context matches JWT claim
 * Prevents cross-tenant data access per plan.md FR-033
 */
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  private readonly logger = new Logger(TenantIsolationGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Tenant context required');
    }

    // Il SUPER_ADMIN è un amministratore di piattaforma cross-tenant: può
    // operare senza un tenant associato e su qualsiasi tenant (eventualmente
    // selezionato via header `X-Tenant-ID`). Determinato SOLO dal ruolo
    // verificato nel token, mai dall'header → nessun bypass per utenti normali.
    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    // Utente normale: deve avere un tenant associato.
    if (!user.tenantId) {
      throw new ForbiddenException('Tenant context required');
    }

    // Validate tenant in route params matches JWT tenant
    const routeTenantId = request.params.tenantId;
    if (routeTenantId && routeTenantId !== user.tenantId) {
      this.logger.warn(
        `⚠️  Cross-tenant access attempt: user tenant ${user.tenantId}, requested ${routeTenantId}`,
      );
      throw new ForbiddenException('Access to other tenant data denied');
    }

    return true;
  }
}
