import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AssignRoleCommand } from '../assign-role.command';
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface';
import { UserRoleRepository } from '../../../domain/identity-access/user-role.repository.interface';
import { UserRole } from '../../../domain/identity-access/user-role.entity';
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service';
import { RedisPubSubService } from '../../../infrastructure/cache/redis-pub-sub.service';
import { UserRoleAssignedEvent } from '../../../domain/events/user-role-assigned.event';

/**
 * AssignRoleCommandHandler
 * Handles role assignment with business rule enforcement
 * Per plan.md FR-008, FR-009: Last admin protection + audit logging
 *
 * Business Rules:
 * - Validate role and user exist
 * - Enforce tenant isolation
 * - Prevent removing last ADMIN
 * - Invalidate permission cache
 * - Publish cache invalidation event
 * - Audit all assignments
 */
@Injectable()
export class AssignRoleCommandHandler {
  private readonly logger = new Logger(AssignRoleCommandHandler.name);

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly userRoleRepository: UserRoleRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly redisPubSub: RedisPubSubService,
    @InjectQueue('audit-logging') private readonly auditQueue: Queue,
  ) {}

  async execute(command: AssignRoleCommand): Promise<UserRole> {
    try {
      // Step 1: Validate role exists and belongs to tenant
      const role = await this.roleRepository.findById(
        command.roleId,
        command.tenantId,
      );

      if (!role) {
        this.logAuditFailure(command, 'Role not found');
        throw new NotFoundException('Role not found');
      }

      if (role.tenantId !== command.tenantId) {
        this.logAuditFailure(command, 'Cross-tenant role assignment denied');
        throw new ForbiddenException('Cross-tenant role assignment denied');
      }

      // Step 2: Validate user exists (assuming we have UserRepository)
      // TODO: Inject UserRepository and validate user exists and belongs to tenant
      // For now, we skip this validation

      // Step 3: Check for existing assignment
      const existingAssignment =
        await this.userRoleRepository.findByUserIdAndRoleId(
          command.userId,
          command.roleId,
          command.tenantId,
        );

      if (existingAssignment && existingAssignment.isActive()) {
        this.logAuditFailure(command, 'Role is already assigned to user');
        throw new BadRequestException('Role is already assigned to user');
      }

      // Step 4: Get current role for audit trail (before changing)
      const currentRoles = await this.userRoleRepository.findActiveByUserId(
        command.userId,
        command.tenantId,
      );
      const oldRoleId = currentRoles.length > 0 ? currentRoles[0].roleId : null;

      // Step 5: Last admin protection (if replacing existing roles)
      if (command.replaceExisting) {
        await this.enforceLastAdminProtection(command, role.name);
      }

      // Step 6: Create user role assignment
      const userRole = UserRole.create({
        userId: command.userId,
        roleId: command.roleId,
        tenantId: command.tenantId,
        assignedBy: command.assignedBy,
        expiresAt: command.expiresAt || null,
        facilityIds: command.facilityIds || null,
        isDelegated: command.isDelegated || false,
        delegationReason: command.delegationReason || null,
      });

      // Step 7: Save to database
      const savedUserRole = await this.userRoleRepository.save(userRole);

      // Step 8: Invalidate user permission cache
      await this.permissionCache.invalidateUser(
        command.tenantId,
        command.userId,
      );

      // Step 9: Publish cache invalidation to all instances
      await this.redisPubSub.publishUserInvalidation(
        command.tenantId,
        command.userId,
      );

      // Step 10: Publish domain event
      const event = new UserRoleAssignedEvent(
        savedUserRole.id,
        savedUserRole.tenantId,
        savedUserRole.userId,
        savedUserRole.roleId,
        role.name,
        savedUserRole.assignedBy,
        savedUserRole.expiresAt,
        savedUserRole.facilityIds,
        savedUserRole.isDelegated,
        savedUserRole.delegationReason,
      );

      // TODO: Publish event to event bus for audit logging
      this.logger.log(
        `✓ Assigned role ${role.name} to user ${command.userId} in tenant ${command.tenantId}`,
      );

      // Step 11: Log successful audit (asynchronous, non-blocking)
      this.logAuditSuccess(command, savedUserRole, oldRoleId, command.roleId).catch((error) => {
        this.logger.error(`Failed to log role change history: ${error.message}`, error.stack);
        // Don't throw - audit logging failure should not break role assignment
      });

      return savedUserRole;
    } catch (error) {
      // Log failure audit
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `Failed to assign role: ${error.message}`,
        error.stack,
      );
      this.logAuditFailure(command, error.message);
      throw error;
    }
  }

  /**
   * Enforce last admin protection
   * Prevent removing last ADMIN from tenant
   */
  private async enforceLastAdminProtection(
    command: AssignRoleCommand,
    newRoleName: string,
  ): Promise<void> {
    // Find ADMIN role
    const adminRole = await this.roleRepository.findByName(
      'ADMIN',
      command.tenantId,
    );

    if (!adminRole) {
      return; // No admin role defined, skip protection
    }

    // Check if user currently has ADMIN role
    const userRoles = await this.userRoleRepository.findActiveByUserId(
      command.userId,
      command.tenantId,
    );

    const hasAdminRole = userRoles.some((ur) => ur.roleId === adminRole.id);

    // If user has ADMIN and we're assigning non-ADMIN role
    if (hasAdminRole && newRoleName !== 'ADMIN') {
      // Count total active admins
      const adminCount = await this.userRoleRepository.countActiveAdmins(
        adminRole.id,
        command.tenantId,
      );

      if (adminCount <= 1) {
        this.logger.warn(
          `⚠️  Blocked attempt to remove last administrator from tenant ${command.tenantId}`,
        );
        throw new ForbiddenException(
          'Cannot remove last administrator from tenant. Assign another admin first.',
        );
      }
    }
  }

  /**
   * Log successful audit
   * T148: Log role changes to RoleChangeHistory asynchronously via BullMQ
   * This achieves <1ms overhead by queuing the audit log
   */
  private async logAuditSuccess(
    command: AssignRoleCommand,
    userRole: UserRole,
    oldRoleId: string | null,
    newRoleId: string,
  ): Promise<void> {
    try {
      // Queue role change audit event (async, <1ms overhead)
      await this.auditQueue.add(
        'role-change',
        {
          type: 'role-change',
          data: {
            userId: command.userId,
            tenantId: command.tenantId,
            oldRoleId,
            newRoleId,
            changedBy: command.assignedBy,
            reason: command.delegationReason || 'Role assignment',
            timestamp: new Date().toISOString(),
            effectiveDate: new Date().toISOString(),
            metadata: {
              expiresAt: command.expiresAt?.toISOString(),
              facilityIds: command.facilityIds,
              isDelegated: command.isDelegated,
            },
          },
        },
        {
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 1000, // Start with 1 second
          },
        },
      );

      this.logger.debug(
        `[AUDIT] Queued role change audit: user=${command.userId}, oldRole=${oldRoleId}, newRole=${newRoleId}, tenant=${command.tenantId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue role change audit: ${error.message}`,
        error.stack,
      );
      // Don't throw - audit logging failure should not break role assignment
    }
  }

  /**
   * Log failed audit
   */
  private logAuditFailure(command: AssignRoleCommand, reason: string): void {
    // TODO: Use AuditLogService to persist audit entry
    this.logger.debug(
      `[AUDIT] DENY assign_role: user=${command.userId}, role=${command.roleId}, tenant=${command.tenantId}, reason=${reason}`,
    );
  }
}
