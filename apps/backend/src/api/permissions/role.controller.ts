import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Logger,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { CurrentTenant } from '../decorators/current-tenant.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RoleRepository } from '../../domain/identity-access/role.repository.interface';
import { PermissionRepository } from '../../domain/identity-access/permission.repository.interface';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { CreateCustomRoleCommand } from '../../application/commands/create-custom-role.command';
import { UpdateCustomRoleCommand } from '../../application/commands/update-custom-role.command';
import { DeleteCustomRoleCommand } from '../../application/commands/delete-custom-role.command';

/**
 * RoleController
 * REST API for role queries
 * Per plan.md FR-004: Role management
 *
 * All endpoints require JWT authentication and tenant isolation
 */
@Controller('roles')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class RoleController {
  private readonly logger = new Logger(RoleController.name);

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly permissionRepository: PermissionRepository,
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Helper method to get permission strings for a role
   */
  private async getRolePermissions(roleId: string): Promise<string[]> {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });

    return rolePermissions.map(rp => rp.permission.resource + ':' + rp.permission.action + ':' + rp.permission.scope);
  }

  /**
   * GET /api/v1/roles
   * List all roles for current tenant
   * Requires: user:read permission
   */
  @Get()
  @RequirePermission('user:read:all')
  async listRoles(@CurrentTenant() tenantId: string) {
    this.logger.log(`Fetching roles for tenant ${tenantId}`);

    const roles = await this.roleRepository.findByTenant(tenantId, false);

    return {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystemRole: role.isSystemRole,
        createdBy: role.createdBy,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * GET /api/v1/roles/:id
   * Get role details with permissions
   * Requires: user:read permission
   */
  @Get(':id')
  @RequirePermission('user:read:all')
  async getRoleById(
    @Param('id') roleId: string,
    @CurrentTenant() tenantId: string,
  ) {
    this.logger.log(`Fetching role ${roleId} for tenant ${tenantId}`);

    const role = await this.roleRepository.findById(roleId, tenantId);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Get permissions for this role
    const permissions = await this.permissionRepository.findByRole(roleId);

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystemRole: role.isSystemRole,
      createdBy: role.createdBy,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
      permissions: permissions.map((p) => ({
        id: p.id,
        permission: p.toString(),
        description: p.description,
        isSensitive: p.isSensitive,
        module: p.module,
      })),
    };
  }

  /**
   * T170: POST /api/v1/roles
   * Create custom role (enterprise only)
   * Requires: role:create:all permission (ADMIN only)
   */
  @Post()
  @RequirePermission('role:create:all')
  @HttpCode(HttpStatus.CREATED)
  async createCustomRole(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      name: string;
      description: string;
      permissions: string[];
    },
  ) {
    this.logger.log(
      `Creating custom role "${body.name}" for tenant ${tenantId}`,
    );

    const command = new CreateCustomRoleCommand(
      tenantId,
      body.name,
      body.description,
      body.permissions,
      user.userId,
    );

    const role = await this.commandBus.execute(command);

    // Fetch permissions separately
    const permissions = await this.getRolePermissions(role.id);

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions,
        isCustom: !role.isSystemRole,
        createdBy: role.createdBy,
        createdAt: role.createdAt.toISOString(),
      },
    };
  }

  /**
   * T171: PUT /api/v1/roles/:id
   * Update custom role
   * Requires: role:update:all permission (ADMIN only)
   */
  @Put(':id')
  @RequirePermission('role:update:all')
  @HttpCode(HttpStatus.OK)
  async updateCustomRole(
    @Param('id') roleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      name?: string;
      description?: string;
      permissions?: string[];
    },
  ) {
    this.logger.log(
      `Updating custom role ${roleId} for tenant ${tenantId}`,
    );

    const command = new UpdateCustomRoleCommand(
      roleId,
      tenantId,
      body.name,
      body.description,
      body.permissions,
      user.userId,
    );

    const role = await this.commandBus.execute(command);

    // Fetch permissions separately
    const rolePermissions = await this.getRolePermissions(role.id);

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: rolePermissions,
        isCustom: !role.isSystemRole,
        updatedAt: role.updatedAt?.toISOString(),
      },
    };
  }

  /**
   * T172: DELETE /api/v1/roles/:id
   * Delete custom role
   * Requires: role:delete:all permission (ADMIN only)
   */
  @Delete(':id')
  @RequirePermission('role:delete:all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCustomRole(
    @Param('id') roleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
  ) {
    this.logger.log(
      `Deleting custom role ${roleId} for tenant ${tenantId}`,
    );

    const command = new DeleteCustomRoleCommand(
      roleId,
      tenantId,
      user.userId,
    );

    await this.commandBus.execute(command);

    // No content response (204)
  }

  /**
   * T173: POST /api/v1/roles/:id/permissions
   * Add permissions to custom role
   * Requires: role:update:all permission (ADMIN only)
   */
  @Post(':id/permissions')
  @RequirePermission('role:update:all')
  @HttpCode(HttpStatus.OK)
  async addPermissionsToRole(
    @Param('id') roleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() body: { permissions: string[] },
  ) {
    this.logger.log(
      `Adding ${body.permissions.length} permissions to role ${roleId}`,
    );

    // Load current role
    const role = await this.roleRepository.findById(roleId, tenantId);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Get current permissions
    const currentPermissions = await this.getRolePermissions(roleId);

    // Merge permissions (avoid duplicates)
    const mergedPermissions = Array.from(
      new Set([...currentPermissions, ...body.permissions]),
    );

    // Update role with merged permissions
    const command = new UpdateCustomRoleCommand(
      roleId,
      tenantId,
      undefined,
      undefined,
      mergedPermissions,
      user.userId,
    );

    const updatedRole = await this.commandBus.execute(command);

    // Get updated permissions
    const updatedPermissions = await this.getRolePermissions(updatedRole.id);

    return {
      success: true,
      data: {
        id: updatedRole.id,
        permissions: updatedPermissions,
        addedCount: updatedPermissions.length - currentPermissions.length,
      },
    };
  }

  /**
   * T174: DELETE /api/v1/roles/:id/permissions/:permissionId
   * Remove permission from custom role
   * Requires: role:update:all permission (ADMIN only)
   */
  @Delete(':id/permissions/:permissionId')
  @RequirePermission('role:update:all')
  @HttpCode(HttpStatus.OK)
  async removePermissionFromRole(
    @Param('id') roleId: string,
    @Param('permissionId') permissionString: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
  ) {
    this.logger.log(
      `Removing permission "${permissionString}" from role ${roleId}`,
    );

    // Load current role
    const role = await this.roleRepository.findById(roleId, tenantId);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Get current permissions
    const currentPermissions = await this.getRolePermissions(roleId);

    // Remove permission
    const filteredPermissions = currentPermissions.filter(
      (p) => p !== permissionString,
    );

    // Update role with filtered permissions
    const command = new UpdateCustomRoleCommand(
      roleId,
      tenantId,
      undefined,
      undefined,
      filteredPermissions,
      user.userId,
    );

    const updatedRole = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        id: updatedRole.id,
        permissions: updatedRole.permissions,
        removedPermission: permissionString,
      },
    };
  }
}
