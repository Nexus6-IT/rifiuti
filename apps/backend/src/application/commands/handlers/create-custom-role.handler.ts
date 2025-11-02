import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateCustomRoleCommand } from '../create-custom-role.command';
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface';
import { Role } from '../../../domain/identity-access/role.entity';
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service';
import { RedisPubSubService } from '../../../infrastructure/cache/redis-pub-sub.service';

/**
 * CreateCustomRoleCommandHandler
 * Command handler for creating custom roles
 * T165: CreateCustomRoleCommandHandler per User Story 5
 *
 * Purpose: Validate permission matrix and create custom role with cache invalidation
 *
 * Requirements from spec.md FR-011:
 * - Validate permission format (resource:action:scope)
 * - Prevent duplicate role names per tenant
 * - Enforce min 1, max 100 permissions
 * - Prevent using system role names (ADMIN, OPERATOR, etc.)
 *
 * Requirements from plan.md:
 * - Invalidate tenant cache on role creation
 * - Broadcast cache invalidation to all instances
 * - Audit all role creation events
 * - <100ms cache invalidation propagation
 */
@CommandHandler(CreateCustomRoleCommand)
@Injectable()
export class CreateCustomRoleCommandHandler
  implements ICommandHandler<CreateCustomRoleCommand>
{
  private readonly logger = new Logger(CreateCustomRoleCommandHandler.name);

  // System role names that cannot be used for custom roles
  private readonly SYSTEM_ROLE_NAMES = [
    'ADMIN',
    'OPERATOR',
    'DRIVER',
    'COMPLIANCE_OFFICER',
    'CONSULTANT',
    'FLEET_MANAGER',
  ];

  // Valid scope values
  private readonly VALID_SCOPES = ['own', 'facility', 'all'];

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly redisPubSub: RedisPubSubService,
  ) {}

  async execute(command: CreateCustomRoleCommand): Promise<Role> {
    try {
      this.logger.log(
        `Creating custom role "${command.name}" for tenant ${command.tenantId}`,
      );

      // Step 1: Validate role name
      this.validateRoleName(command.name);

      // Step 2: Check for duplicate role name in tenant
      const existingRole = await this.roleRepository.findByName(
        command.name,
        command.tenantId,
      );

      if (existingRole) {
        throw new BadRequestException('Role with this name already exists in this tenant');
      }

      // Step 3: Validate permissions
      this.validatePermissions(command.permissions);

      // Step 4: Create role entity
      const role = Role.create({
        name: command.name,
        description: command.description,
        tenantId: command.tenantId,
        isSystemRole: false,
        createdBy: command.createdBy,
      });

      // Step 5: Save to database
      const savedRole = await this.roleRepository.save(role);

      // Step 6: Invalidate tenant cache
      await this.permissionCache.invalidateTenant(command.tenantId);

      // Step 7: Broadcast invalidation to all instances
      await this.redisPubSub.publishTenantInvalidation(command.tenantId);

      this.logger.log(
        `✓ Created custom role "${command.name}" with ${command.permissions.length} permissions`,
      );

      return savedRole;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Failed to create custom role: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Failed to create custom role: ${error.message}`);
    }
  }

  /**
   * Validate role name
   */
  private validateRoleName(name: string): void {
    if (!name || name.trim() === '') {
      throw new BadRequestException('Role name is required');
    }

    if (name.length > 100) {
      throw new BadRequestException('Role name must be 100 characters or less');
    }

    // Check if trying to use system role name
    if (this.SYSTEM_ROLE_NAMES.includes(name.toUpperCase())) {
      throw new BadRequestException(
        `Cannot use system role names: ${this.SYSTEM_ROLE_NAMES.join(', ')}`,
      );
    }
  }

  /**
   * Validate permission matrix
   */
  private validatePermissions(permissions: string[]): void {
    // Check minimum permissions
    if (!permissions || permissions.length === 0) {
      throw new BadRequestException('At least 1 permission is required');
    }

    // Check maximum permissions
    if (permissions.length > 100) {
      throw new BadRequestException('Maximum 100 permissions allowed per role');
    }

    // Check for duplicates
    const uniquePermissions = new Set(permissions);
    if (uniquePermissions.size !== permissions.length) {
      throw new BadRequestException('Duplicate permissions are not allowed');
    }

    // Validate each permission format
    for (const permission of permissions) {
      this.validatePermissionFormat(permission);
    }
  }

  /**
   * Validate single permission format
   * Format: resource:action:scope
   */
  private validatePermissionFormat(permission: string): void {
    if (!permission || permission.trim() === '') {
      throw new BadRequestException('Permission cannot be empty');
    }

    const parts = permission.split(':');

    if (parts.length !== 3) {
      throw new BadRequestException(
        `Invalid permission format: "${permission}". Expected format: resource:action:scope`,
      );
    }

    const [resource, action, scope] = parts;

    // Validate resource
    if (!resource || resource.trim() === '') {
      throw new BadRequestException(
        `Invalid permission "${permission}": resource is required`,
      );
    }

    // Validate action
    if (!action || action.trim() === '') {
      throw new BadRequestException(
        `Invalid permission "${permission}": action is required`,
      );
    }

    // Validate scope
    if (!scope || scope.trim() === '') {
      throw new BadRequestException(
        `Invalid permission "${permission}": scope is required`,
      );
    }

    // Validate scope value
    if (!this.VALID_SCOPES.includes(scope)) {
      throw new BadRequestException(
        `Invalid scope "${scope}" in permission "${permission}". Valid scopes: ${this.VALID_SCOPES.join(', ')}`,
      );
    }
  }
}
