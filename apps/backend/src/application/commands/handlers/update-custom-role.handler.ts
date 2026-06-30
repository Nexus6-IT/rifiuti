import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { UpdateCustomRoleCommand } from '../update-custom-role.command'
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface'
import { Role } from '../../../domain/identity-access/role.entity'
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service'
import { RedisPubSubService } from '../../../infrastructure/cache/redis-pub-sub.service'

/**
 * UpdateCustomRoleCommandHandler
 * Command handler for updating custom roles with immediate cache invalidation
 * T167: UpdateCustomRoleCommandHandler per User Story 5
 *
 * Purpose: Modify custom role and ensure immediate cache invalidation
 *
 * Requirements from spec.md FR-011 acceptance scenario 4:
 * - Changes take effect immediately for all users
 * - Synchronous cache invalidation
 * - Cannot modify system roles
 *
 * Requirements from plan.md:
 * - <100ms cache invalidation propagation
 * - Broadcast invalidation to all instances
 * - Audit all role modification events
 */
@CommandHandler(UpdateCustomRoleCommand)
@Injectable()
export class UpdateCustomRoleCommandHandler implements ICommandHandler<UpdateCustomRoleCommand> {
  private readonly logger = new Logger(UpdateCustomRoleCommandHandler.name)

  // System role names that cannot be modified
  private readonly SYSTEM_ROLE_NAMES = [
    'ADMIN',
    'OPERATOR',
    'DRIVER',
    'COMPLIANCE_OFFICER',
    'CONSULTANT',
    'FLEET_MANAGER',
  ]

  // Valid scope values
  private readonly VALID_SCOPES = ['own', 'facility', 'all']

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly redisPubSub: RedisPubSubService
  ) {}

  async execute(command: UpdateCustomRoleCommand): Promise<Role> {
    try {
      this.logger.log(`Updating custom role ${command.roleId} for tenant ${command.tenantId}`)

      // Step 1: Load existing role
      const existingRole = await this.roleRepository.findById(command.roleId, command.tenantId)

      if (!existingRole) {
        throw new NotFoundException('Role not found')
      }

      // Step 2: Validate tenant isolation
      if (existingRole.tenantId !== command.tenantId) {
        throw new ForbiddenException('Cannot modify role from different tenant')
      }

      // Step 3: Prevent modifying system roles
      if (existingRole.isSystemRole) {
        throw new ForbiddenException('Cannot modify system roles')
      }

      // Step 4: Validate updated name (if provided)
      if (command.name && command.name !== existingRole.name) {
        this.validateRoleName(command.name)

        // Check for duplicate name
        const duplicateRole = await this.roleRepository.findByName(command.name, command.tenantId)

        if (duplicateRole && duplicateRole.id !== command.roleId) {
          throw new BadRequestException('Role with this name already exists in this tenant')
        }
      }

      // Step 5: Validate updated permissions (if provided)
      if (command.permissions) {
        this.validatePermissions(command.permissions)
      }

      // Step 6: Update role
      const updatedRole = Role.fromPersistence({
        ...existingRole,
        name: command.name || existingRole.name,
        description: command.description || existingRole.description,
        updatedAt: new Date(),
      })

      // Step 7: Save to database
      await this.roleRepository.save(updatedRole)

      // Step 8: Invalidate role cache (immediate, synchronous)
      await this.permissionCache.invalidateTenant(command.tenantId)

      // Step 9: Broadcast invalidation to all instances
      await this.redisPubSub.publishRoleInvalidation(command.tenantId, command.roleId)

      this.logger.log(`✓ Updated custom role "${updatedRole.name}" - cache invalidation completed`)

      return updatedRole
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error
      }

      this.logger.error(`Failed to update custom role: ${error.message}`, error.stack)
      throw new BadRequestException(`Failed to update custom role: ${error.message}`)
    }
  }

  /**
   * Validate role name
   */
  private validateRoleName(name: string): void {
    if (!name || name.trim() === '') {
      throw new BadRequestException('Role name is required')
    }

    if (name.length > 100) {
      throw new BadRequestException('Role name must be 100 characters or less')
    }

    // Check if trying to use system role name
    if (this.SYSTEM_ROLE_NAMES.includes(name.toUpperCase())) {
      throw new BadRequestException(
        `Cannot use system role names: ${this.SYSTEM_ROLE_NAMES.join(', ')}`
      )
    }
  }

  /**
   */
  private validatePermissions(permissions: string[]): void {
    if (!permissions || permissions.length === 0) {
      throw new BadRequestException('At least 1 permission is required')
    }

    // Check maximum permissions
    if (permissions.length > 100) {
      throw new BadRequestException('Maximum 100 permissions allowed per role')
    }

    // Check for duplicates
    const uniquePermissions = new Set(permissions)
    if (uniquePermissions.size !== permissions.length) {
      throw new BadRequestException('Duplicate permissions are not allowed')
    }

    // Validate each permission format
    for (const permission of permissions) {
      this.validatePermissionFormat(permission)
    }
  }

  /**
   * Validate single permission format
   * Format: resource:action:scope
   */
  private validatePermissionFormat(permission: string): void {
    if (!permission || permission.trim() === '') {
      throw new BadRequestException('Permission cannot be empty')
    }

    const parts = permission.split(':')

    if (parts.length !== 3) {
      throw new BadRequestException(
        `Invalid permission format: "${permission}". Expected format: resource:action:scope`
      )
    }

    const [resource, action, scope] = parts

    // Validate resource
    if (!resource || resource.trim() === '') {
      throw new BadRequestException(`Invalid permission "${permission}": resource is required`)
    }

    // Validate action
    if (!action || action.trim() === '') {
      throw new BadRequestException(`Invalid permission "${permission}": action is required`)
    }

    // Validate scope
    if (!scope || scope.trim() === '') {
      throw new BadRequestException(`Invalid permission "${permission}": scope is required`)
    }

    // Validate scope value
    if (!this.VALID_SCOPES.includes(scope)) {
      throw new BadRequestException(
        `Invalid scope "${scope}" in permission "${permission}". Valid scopes: ${this.VALID_SCOPES.join(', ')}`
      )
    }
  }
}
