import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SwitchTenantContextCommand } from '../switch-tenant-context.command';
import { ConsultantTenantAssociationRepository } from '../../../domain/identity-access/consultant-tenant-association.repository.interface';
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service';
import { RoleCacheService } from '../../../infrastructure/cache/role-cache.service';
import { TenantContextSwitchedEvent } from '../../../domain/events/tenant-context-switched.event';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * SwitchTenantContextCommandHandler
 * Handles tenant context switching for consultants
 * Per plan.md: Must complete in <2 seconds (JWT regen + cache ops)
 *
 * Implementation Steps:
 * 1. Validate consultant has active association with target tenant
 * 2. Invalidate permission cache for user in source tenant
 * 3. Warm cache for target tenant (best-effort, non-blocking)
 * 4. Generate new JWT with target tenant context
 * 5. Publish TenantContextSwitchedEvent for audit trail
 * 6. Return new JWT and tenant context
 *
 * Performance Optimizations:
 * - Cache operations run in parallel where possible
 * - JWT signing is synchronous and fast (<10ms)
 * - Cache warming is best-effort (doesn't block response)
 * - Database query uses indexed lookup (consultantUserId, tenantId)
 *
 * Security Considerations:
 * - Prevents switching to tenant without active association
 * - Checks association expiration
 * - Validates association is active
 * - Logs all switches for audit trail
 */
@Injectable()
export class SwitchTenantContextCommandHandler {
  private readonly logger = new Logger(SwitchTenantContextCommandHandler.name);

  constructor(
    private readonly consultantAssociationRepository: ConsultantTenantAssociationRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly roleCache: RoleCacheService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(command: SwitchTenantContextCommand): Promise<{
    newJwt: string;
    tenantId: string;
    roleId: string;
  }> {
    const startTime = Date.now();

    this.logger.log(
      `Consultant ${command.consultantUserId} switching from ${command.sourceTenantId} to ${command.targetTenantId}`,
    );

    // Step 1: Validate association exists and is active
    const association = await this.consultantAssociationRepository.findActiveByConsultantAndTenant(
      command.consultantUserId,
      command.targetTenantId,
    );

    if (!association) {
      this.logger.warn(
        `No active association found for consultant ${command.consultantUserId} with tenant ${command.targetTenantId}`,
      );
      throw new NotFoundException(
        `No active association found for consultant ${command.consultantUserId} with tenant ${command.targetTenantId}`,
      );
    }

    // Validate association is active and not expired
    if (!association.isActiveAndNotExpired()) {
      this.logger.warn(
        `Association ${association.id} is inactive or expired for consultant ${command.consultantUserId}`,
      );
      throw new ForbiddenException(
        'Association with target tenant is inactive or expired',
      );
    }

    // Step 2: Invalidate permission cache for source tenant
    try {
      await this.permissionCache.invalidateUser(
        command.sourceTenantId,
        command.consultantUserId,
      );
      this.logger.debug(
        `Invalidated permission cache for user ${command.consultantUserId} in tenant ${command.sourceTenantId}`,
      );
    } catch (error) {
      // Cache invalidation failure is logged but doesn't block the switch
      this.logger.error(
        `Failed to invalidate permission cache: ${error.message}`,
        error.stack,
      );
    }

    // Step 3: Warm cache for target tenant (best-effort, non-blocking)
    // Run cache warming in background without awaiting
    this.warmCacheForTenant(command.targetTenantId).catch((error) => {
      this.logger.warn(
        `Cache warming failed for tenant ${command.targetTenantId}: ${error.message}`,
      );
    });

    // Step 4: Generate new JWT with target tenant context
    const jwtPayload = {
      userId: command.consultantUserId,
      tenantId: command.targetTenantId,
      roleId: association.roleId,
      isConsultant: true,
      consultantMode: true,
    };

    const newJwt = await this.jwtService.signAsync(jwtPayload);

    this.logger.debug(
      `Generated new JWT for consultant ${command.consultantUserId} in tenant ${command.targetTenantId}`,
    );

    // Step 5: Publish TenantContextSwitchedEvent for audit trail
    const event = new TenantContextSwitchedEvent(
      command.consultantUserId,
      command.sourceTenantId,
      command.targetTenantId,
      association.roleId,
      new Date(),
    );

    this.eventEmitter.emit('tenant.context.switched', event);

    const duration = Date.now() - startTime;
    this.logger.log(
      `Context switch completed in ${duration}ms for consultant ${command.consultantUserId}`,
    );

    // Verify performance target: <2 seconds per plan.md
    if (duration > 2000) {
      this.logger.warn(
        `Context switch took ${duration}ms, exceeding 2s target for consultant ${command.consultantUserId}`,
      );
    }

    return {
      newJwt,
      tenantId: command.targetTenantId,
      roleId: association.roleId,
    };
  }

  /**
   * Warm cache for target tenant (best-effort)
   * Runs asynchronously to not block response
   */
  private async warmCacheForTenant(tenantId: string): Promise<void> {
    try {
      // Cache warming is optional and currently not implemented on RoleCacheService
      // await this.roleCache.warmTenantRoles(tenantId);
      this.logger.debug(`Cache warming skipped for tenant ${tenantId}`);
    } catch (error) {
      // Cache warming is best-effort, failure doesn't affect functionality
      this.logger.debug(
        `Cache warming failed for tenant ${tenantId}: ${error.message}`,
      );
    }
  }
}
