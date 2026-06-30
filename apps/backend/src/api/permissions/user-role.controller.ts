import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard'
import { PermissionGuard } from '../guards/permission.guard'
import { RequirePermission } from '../decorators/require-permission.decorator'
import { CurrentTenant } from '../decorators/current-tenant.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import { AuditAction } from '../decorators/audit-action.decorator'
import { AssignRoleCommandHandler } from '../../application/commands/handlers/assign-role.handler'
import { RevokeRoleCommandHandler } from '../../application/commands/handlers/revoke-role.handler'
import { AssignRoleCommand } from '../../application/commands/assign-role.command'
import { RevokeRoleCommand } from '../../application/commands/revoke-role.command'
import { UserRoleRepository } from '../../domain/identity-access/user-role.repository.interface'

/**
 * UserRoleController
 * REST API for role assignment operations
 * Per plan.md FR-008: Role assignment with ABAC enforcement
 *
 * All endpoints require:
 * - JWT authentication
 * - Tenant isolation validation
 * - Permission checks
 */
@Controller('user-roles')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class UserRoleController {
  private readonly logger = new Logger(UserRoleController.name)

  constructor(
    private readonly assignRoleHandler: AssignRoleCommandHandler,
    private readonly revokeRoleHandler: RevokeRoleCommandHandler,
    private readonly userRoleRepository: UserRoleRepository
  ) {}

  /**
   * POST /api/v1/user-roles/assign
   * Assign a role to a user
   * Requires: user:manage permission
   */
  @Post('assign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('user:manage:all')
  @AuditAction('assign_role')
  async assignRole(
    @Body() dto: AssignRoleDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') currentUserId: string
  ) {
    this.logger.log(`Assigning role ${dto.roleId} to user ${dto.userId} in tenant ${tenantId}`)

    const command = new AssignRoleCommand(
      dto.userId,
      dto.roleId,
      tenantId,
      currentUserId,
      dto.expiresAt ? new Date(dto.expiresAt) : null,
      dto.facilityIds || null,
      dto.isDelegated || false,
      dto.delegationReason || null,
      dto.replaceExisting || false
    )

    const userRole = await this.assignRoleHandler.execute(command)

    return {
      id: userRole.id,
      userId: userRole.userId,
      roleId: userRole.roleId,
      tenantId: userRole.tenantId,
      assignedBy: userRole.assignedBy,
      assignedAt: userRole.assignedAt.toISOString(),
      expiresAt: userRole.expiresAt?.toISOString() || null,
      facilityIds: userRole.facilityIds,
      isDelegated: userRole.isDelegated,
      delegationReason: userRole.delegationReason,
    }
  }

  /**
   * DELETE /api/v1/user-roles/:id
   * Revoke a role assignment
   * Requires: user:manage permission
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('user:manage:all')
  @AuditAction('revoke_role')
  async revokeRole(
    @Param('id') userRoleId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') currentUserId: string
  ) {
    this.logger.log(`Revoking user role assignment ${userRoleId} in tenant ${tenantId}`)

    const command = new RevokeRoleCommand(userRoleId, tenantId, currentUserId, 'Revoked via API')

    await this.revokeRoleHandler.execute(command)

    return // 204 No Content
  }

  /**
   * GET /api/v1/user-roles/user/:userId
   * Get all role assignments for a user
   * Requires: user:read permission
   */
  @Get('user/:userId')
  @RequirePermission('user:read:all')
  async getUserRoles(@Param('userId') userId: string, @CurrentTenant() tenantId: string) {
    this.logger.log(`Fetching role assignments for user ${userId}`)

    const userRoles = await this.userRoleRepository.findActiveByUserId(userId, tenantId)

    return {
      userRoles: userRoles.map(ur => ({
        id: ur.id,
        userId: ur.userId,
        roleId: ur.roleId,
        assignedBy: ur.assignedBy,
        assignedAt: ur.assignedAt.toISOString(),
        expiresAt: ur.expiresAt?.toISOString() || null,
        facilityIds: ur.facilityIds,
        isDelegated: ur.isDelegated,
        isActive: ur.isActive(),
      })),
    }
  }
}

/**
 * DTO for role assignment
 */
export class AssignRoleDto {
  userId: string
  roleId: string
  expiresAt?: string // ISO 8601 date string
  facilityIds?: string[]
  isDelegated?: boolean
  delegationReason?: string
  replaceExisting?: boolean
}
