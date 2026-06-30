import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard'
import { RequirePermission } from '../decorators/require-permission.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import { CurrentTenant } from '../decorators/current-tenant.decorator'
import { AuditAction } from '../decorators/audit-action.decorator'
import { SwitchTenantContextCommand } from '../../application/commands/switch-tenant-context.command'
import { SwitchTenantContextCommandHandler } from '../../application/commands/handlers/switch-tenant-context.handler'
import { GetConsultantTenantsQuery } from '../../application/queries/get-consultant-tenants.query'
import { GetConsultantTenantsQueryHandler } from '../../application/queries/handlers/get-consultant-tenants.handler'
import { GetAggregatedDashboardQuery } from '../../application/queries/get-aggregated-dashboard.query'
import { GetAggregatedDashboardQueryHandler } from '../../application/queries/handlers/get-aggregated-dashboard.handler'
import { ConsultantTenantAssociationRepository } from '../../domain/identity-access/consultant-tenant-association.repository.interface'
import { ConsultantTenantAssociation } from '../../domain/identity-access/consultant-tenant-association.entity'

/**
 * ConsultantController
 * API endpoints for consultant multi-tenant management
 * Per spec.md: Environmental consultants can manage 50+ client tenants
 *
 * Endpoints:
 * - GET /api/v1/consultant/tenants - List all accessible tenants
 * - POST /api/v1/consultant/switch-tenant - Switch context to different tenant
 * - GET /api/v1/consultant/dashboard - Aggregated cross-tenant dashboard
 * - POST /api/v1/consultant/associate - Add consultant to tenant (admin only)
 * - DELETE /api/v1/consultant/associations/:id - Remove consultant association (admin only)
 *
 * Security:
 * - All endpoints require JWT authentication
 * - Tenant isolation enforced (consultant can only switch to associated tenants)
 * - Admin endpoints require 'consultant:manage' permission
 * - All operations logged for audit trail
 */
@Controller('consultant')
@UseGuards(JwtAuthGuard, TenantIsolationGuard)
export class ConsultantController {
  private readonly logger = new Logger(ConsultantController.name)

  constructor(
    private readonly switchTenantContextHandler: SwitchTenantContextCommandHandler,
    private readonly getConsultantTenantsHandler: GetConsultantTenantsQueryHandler,
    private readonly getAggregatedDashboardHandler: GetAggregatedDashboardQueryHandler,
    private readonly consultantAssociationRepository: ConsultantTenantAssociationRepository
  ) {}

  /**
   * T110: GET /api/v1/consultant/tenants
   * List all tenants accessible by consultant
   * Per spec.md: Support 50+ client tenants
   *
   * Response:
   * - Array of tenants with role and expiration info
   * - Total count of active associations
   * - Ordered by most recently added
   */
  @Get('tenants')
  @HttpCode(HttpStatus.OK)
  @AuditAction('list_consultant_tenants')
  async listTenants(@CurrentUser('userId') userId: string) {
    this.logger.log(`Consultant ${userId} fetching accessible tenants`)

    const query = new GetConsultantTenantsQuery(userId)
    const result = await this.getConsultantTenantsHandler.execute(query)

    return {
      tenants: result.tenants,
      totalActiveAssociations: result.totalActiveAssociations,
    }
  }

  /**
   * T111: POST /api/v1/consultant/switch-tenant
   * Switch consultant's active tenant context
   * Per plan.md: Must complete in <2 seconds
   *
   * Request Body:
   * - targetTenantId: Tenant ID to switch to
   *
   * Response:
   * - newJwt: New JWT token with updated tenant context
   * - tenantId: Target tenant ID
   * - roleId: Role in target tenant
   *
   * Side Effects:
   * - Permission cache invalidated for source tenant
   * - Role cache warmed for target tenant
   * - Audit trail logged
   */
  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  @AuditAction('switch_tenant_context')
  async switchTenant(
    @CurrentUser('userId') userId: string,
    @CurrentTenant() sourceTenantId: string,
    @Body('targetTenantId') targetTenantId: string
  ) {
    this.logger.log(`Consultant ${userId} switching from ${sourceTenantId} to ${targetTenantId}`)

    const command = new SwitchTenantContextCommand(userId, sourceTenantId, targetTenantId)

    const result = await this.switchTenantContextHandler.execute(command)

    return {
      newJwt: result.newJwt,
      tenantId: result.tenantId,
      roleId: result.roleId,
      message: `Successfully switched to tenant ${result.tenantId}`,
    }
  }

  /**
   * T112: GET /api/v1/consultant/dashboard
   * Aggregated dashboard with cross-tenant KPIs
   * Per spec.md: Show pending FIRs, MUD deadlines, RENTRI sync failures
   *
   * Response:
   * - totalTenants: Number of client tenants
   * - totalPendingFirs: Pending FIRs across all clients
   * - totalMudDeadlines: Upcoming deadlines
   * - totalRentriSyncFailures: Sync issues requiring attention
   * - pendingFirsByClient: Breakdown by tenant
   * - upcomingDeadlines: Next 20 deadlines
   * - recentActivity: Last 20 activities across all tenants
   */
  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @AuditAction('view_consultant_dashboard')
  async getDashboard(@CurrentUser('userId') userId: string) {
    this.logger.log(`Consultant ${userId} fetching aggregated dashboard`)

    const query = new GetAggregatedDashboardQuery(userId)
    const result = await this.getAggregatedDashboardHandler.execute(query)

    return result
  }

  /**
   * T113: POST /api/v1/consultant/associate
   * Add consultant to tenant (admin only)
   * Per spec.md: Tenant admin can grant consultant access
   *
   * Request Body:
   * - consultantUserId: User ID of consultant
   * - roleId: Role to assign in this tenant
   * - expiresAt: Optional expiration date
   *
   * Response:
   * - association: Created association details
   */
  @Post('associate')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('consultant:manage:all')
  @AuditAction('associate_consultant_with_tenant')
  async associateConsultant(
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') adminUserId: string,
    @Body('consultantUserId') consultantUserId: string,
    @Body('roleId') roleId: string,
    @Body('expiresAt') expiresAt?: string
  ) {
    this.logger.log(
      `Admin ${adminUserId} associating consultant ${consultantUserId} with tenant ${tenantId}`
    )

    // Create new association
    const association = ConsultantTenantAssociation.create({
      consultantUserId,
      tenantId,
      roleId,
      addedBy: adminUserId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })

    const saved = await this.consultantAssociationRepository.save(association)

    return {
      association: {
        id: saved.id,
        consultantUserId: saved.consultantUserId,
        tenantId: saved.tenantId,
        roleId: saved.roleId,
        addedAt: saved.addedAt,
        expiresAt: saved.expiresAt,
        isActive: saved.isActive,
      },
      message: `Consultant ${consultantUserId} successfully associated with tenant ${tenantId}`,
    }
  }

  /**
   * T114: DELETE /api/v1/consultant/associations/:id
   * Remove consultant association (admin only)
   * Per spec.md: Tenant admin can revoke consultant access
   *
   * Path Params:
   * - id: Association ID
   *
   * Response:
   * - message: Confirmation message
   */
  @Delete('associations/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('consultant:manage:all')
  @AuditAction('remove_consultant_association')
  async removeAssociation(
    @Param('id') associationId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') adminUserId: string
  ) {
    this.logger.log(`Admin ${adminUserId} removing consultant association ${associationId}`)

    // Fetch association to verify it belongs to current tenant
    const association = await this.consultantAssociationRepository.findById(associationId)

    if (!association) {
      throw new Error(`Consultant association ${associationId} not found`)
    }

    // Verify association belongs to current tenant (tenant isolation)
    if (association.tenantId !== tenantId) {
      throw new Error('Cannot remove association from different tenant')
    }

    // Deactivate instead of hard delete (audit trail preservation)
    await this.consultantAssociationRepository.deactivate(associationId)

    return {
      message: `Consultant association ${associationId} has been removed`,
      associationId,
      consultantUserId: association.consultantUserId,
    }
  }
}
