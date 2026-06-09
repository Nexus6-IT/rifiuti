import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RevokeRoleCommand } from '../revoke-role.command';
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface';
import { UserRoleRepository } from '../../../domain/identity-access/user-role.repository.interface';
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service';
import { RedisPubSubService } from '../../../infrastructure/cache/redis-pub-sub.service';

/**
 * RevokeRoleCommandHandler
 * Handles role revocation with business rule enforcement
 * Per plan.md FR-009: Last admin protection
 *
 * Business Rules:
 * - Validate user role assignment exists
 * - Enforce tenant isolation
 * - Prevent removing last ADMIN
 * - Invalidate permission cache
 * - Publish cache invalidation event
 * - Audit all revocations
 */
@Injectable()
export class RevokeRoleCommandHandler {
  private readonly logger = new Logger(RevokeRoleCommandHandler.name);

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly userRoleRepository: UserRoleRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly redisPubSub: RedisPubSubService,
    @InjectQueue('audit-logging') private readonly auditQueue: Queue,
  ) {}

  async execute(command: RevokeRoleCommand): Promise<void> {
    try {
      // Step 1: Find user role assignment
      const userRole = await this.userRoleRepository.findById(
        command.userRoleId,
        command.tenantId,
      );

      if (!userRole) {
        this.logAuditFailure(command, 'User role assignment not found');
        throw new NotFoundException('User role assignment not found');
      }

      // Step 2: Validate tenant isolation
      if (userRole.tenantId !== command.tenantId) {
        this.logAuditFailure(command, 'Cross-tenant revocation denied');
        throw new ForbiddenException('Cross-tenant revocation denied');
      }

      // Step 3: Get role details
      const role = await this.roleRepository.findById(
        userRole.roleId,
        command.tenantId,
      );

      if (!role) {
        this.logAuditFailure(command, 'Role not found');
        throw new NotFoundException('Role not found');
      }

      // Step 4: Last admin protection
      if (role.name === 'ADMIN') {
        await this.enforceLastAdminProtection(userRole.roleId, command.tenantId);
      }

      // Step 5: Revoke assignment
      await this.userRoleRepository.revoke(command.userRoleId, command.tenantId);

      // Step 6: Invalidate user permission cache
      await this.permissionCache.invalidateUser(
        command.tenantId,
        userRole.userId,
      );

      // Step 7: Publish cache invalidation to all instances
      await this.redisPubSub.publishUserInvalidation(
        command.tenantId,
        userRole.userId,
      );

      this.logger.log(
        `✓ Revoked role ${role.name} from user ${userRole.userId} in tenant ${command.tenantId}`,
      );

      // Step 8: Persist the revocation to the audit trail (async, non-blocking).
      // A revocation is a role change with newRoleId = null. Failures here must
      // not break the revocation itself.
      this.logAuditSuccess(command, userRole.userId, userRole.roleId, role.name).catch(
        (error) => {
          this.logger.error(
            `Failed to log role revocation history: ${error.message}`,
            error.stack,
          );
        },
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error(`Failed to revoke role: ${error.message}`, error.stack);
      this.logAuditFailure(command, error.message);
      throw error;
    }
  }

  /**
   * Enforce last admin protection
   * Prevent removing last ADMIN from tenant
   */
  private async enforceLastAdminProtection(
    adminRoleId: string,
    tenantId: string,
  ): Promise<void> {
    // Count total active admins
    const adminCount = await this.userRoleRepository.countActiveAdmins(
      adminRoleId,
      tenantId,
    );

    if (adminCount <= 1) {
      this.logger.warn(
        `⚠️  Blocked attempt to revoke last administrator from tenant ${tenantId}`,
      );
      throw new ForbiddenException(
        'Cannot revoke last administrator from tenant. Assign another admin first.',
      );
    }
  }

  /**
   * Persist a successful revocation to RoleChangeHistory via the audit queue.
   * Mirrors AssignRoleCommandHandler: queue a 'role-change' event consumed by
   * AuditLoggingProcessor. A revocation has oldRoleId = the revoked role and
   * newRoleId = null. <1ms overhead; retried up to 3 times by BullMQ.
   */
  private async logAuditSuccess(
    command: RevokeRoleCommand,
    userId: string,
    revokedRoleId: string,
    roleName: string,
  ): Promise<void> {
    await this.auditQueue.add(
      'role-change',
      {
        type: 'role-change',
        data: {
          userId,
          tenantId: command.tenantId,
          oldRoleId: revokedRoleId,
          newRoleId: null,
          changedBy: command.revokedBy,
          reason: command.reason || 'Role revocation',
          timestamp: new Date().toISOString(),
          effectiveDate: new Date().toISOString(),
          metadata: { userRoleId: command.userRoleId, roleName },
        },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );

    this.logger.debug(
      `[AUDIT] Queued role revocation: userRole=${command.userRoleId}, user=${userId}, role=${roleName}, tenant=${command.tenantId}`,
    );
  }

  /**
   * Log a denied revocation attempt. Denials are NOT persisted to
   * RoleChangeHistory (no role actually changed); they are operational events.
   */
  private logAuditFailure(command: RevokeRoleCommand, reason: string): void {
    this.logger.debug(
      `[AUDIT] DENY revoke_role: userRole=${command.userRoleId}, tenant=${command.tenantId}, reason=${reason}`,
    );
  }
}
