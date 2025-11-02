import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteCustomRoleCommand } from '../delete-custom-role.command';
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface';
import { UserRoleRepository } from '../../../domain/identity-access/user-role.repository.interface';
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service';
import { RedisPubSubService } from '../../../infrastructure/cache/redis-pub-sub.service';

/**
 * DeleteCustomRoleCommandHandler
 * Command handler for deleting custom roles with protection
 * T169: DeleteCustomRoleCommandHandler per User Story 5
 *
 * Purpose: Delete custom role with safety checks and cache invalidation
 *
 * Requirements from spec.md FR-011 acceptance scenario 5:
 * - Prevent deleting role assigned to users
 * - Cannot delete system roles
 * - Provide clear error messages
 *
 * Requirements from plan.md:
 * - Check for active user assignments before deletion
 * - Invalidate caches on successful deletion
 * - Audit all role deletion events
 */
@CommandHandler(DeleteCustomRoleCommand)
@Injectable()
export class DeleteCustomRoleCommandHandler
  implements ICommandHandler<DeleteCustomRoleCommand>
{
  private readonly logger = new Logger(DeleteCustomRoleCommandHandler.name);

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly userRoleRepository: UserRoleRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly redisPubSub: RedisPubSubService,
  ) {}

  async execute(command: DeleteCustomRoleCommand): Promise<void> {
    try {
      this.logger.log(
        `Attempting to delete role ${command.roleId} for tenant ${command.tenantId}`,
      );

      // Step 1: Load existing role
      const role = await this.roleRepository.findById(
        command.roleId,
        command.tenantId,
      );

      if (!role) {
        throw new NotFoundException('Role not found');
      }

      // Step 2: Validate tenant isolation
      if (role.tenantId !== command.tenantId) {
        throw new ForbiddenException('Cannot delete role from different tenant');
      }

      // Step 3: Prevent deleting system roles
      if (role.isSystemRole) {
        throw new ForbiddenException(
          'Cannot delete system roles. System roles are: ADMIN, OPERATOR, DRIVER, COMPLIANCE_OFFICER, CONSULTANT, FLEET_MANAGER',
        );
      }

      // Step 4: Check if role is assigned to any users
      const usersWithRole = await this.userRoleRepository.findByRoleId(
        command.roleId,
        command.tenantId,
      );

      if (usersWithRole.length > 0) {
        throw new BadRequestException(
          `Cannot delete role "${role.name}" because it is assigned to ${usersWithRole.length} user(s). Remove all user assignments before deleting this role.`,
        );
      }

      // Step 5: Delete role from database
      await this.roleRepository.delete(command.roleId, command.tenantId);

      // Step 6: Invalidate tenant cache
      await this.permissionCache.invalidateTenant(command.tenantId);

      // Step 7: Broadcast invalidation to all instances
      await this.redisPubSub.publishTenantInvalidation(command.tenantId);

      this.logger.log(
        `✓ Deleted custom role "${role.name}" for tenant ${command.tenantId}`,
      );
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `Failed to delete custom role: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Failed to delete custom role: ${error.message}`);
    }
  }
}
