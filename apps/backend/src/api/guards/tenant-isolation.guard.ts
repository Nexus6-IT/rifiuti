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

    if (!user || !user.tenantId) {
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
