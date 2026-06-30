import { Controller, Get, UseGuards, Logger, Query } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard'
import { CurrentTenant } from '../decorators/current-tenant.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import { GetUserPermissionsQueryHandler } from '../../application/queries/handlers/get-user-permissions.handler'
import { GetUserPermissionsQuery } from '../../application/queries/get-user-permissions.query'

/**
 * PermissionController
 * REST API for permission queries
 * Per plan.md FR-001: Permission lookup for authorization
 *
 * All endpoints require JWT authentication
 */
@Controller('permissions')
@UseGuards(JwtAuthGuard, TenantIsolationGuard)
export class PermissionController {
  private readonly logger = new Logger(PermissionController.name)

  constructor(private readonly getUserPermissionsHandler: GetUserPermissionsQueryHandler) {}

  /**
   * GET /api/v1/permissions/my-permissions
   * Get current user's effective permissions
   * Used by frontend to determine UI visibility and enabled actions
   */
  @Get('my-permissions')
  async getMyPermissions(
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query('includeTemp') includeTemp?: string
  ) {
    this.logger.debug(`Fetching permissions for user ${userId} in tenant ${tenantId}`)

    const query = new GetUserPermissionsQuery(userId, tenantId, includeTemp === 'true')

    const result = await this.getUserPermissionsHandler.execute(query)

    return {
      permissions: result.permissions,
      facilityIds: result.facilityIds,
      source: result.source,
      cachedAt: new Date().toISOString(),
    }
  }

  /**
   * GET /api/v1/permissions/me
   * Alias for my-permissions (backward compatibility)
   */
  @Get('me')
  async getPermissionsMe(
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query('includeTemp') includeTemp?: string
  ) {
    return this.getMyPermissions(tenantId, userId, includeTemp)
  }
}
