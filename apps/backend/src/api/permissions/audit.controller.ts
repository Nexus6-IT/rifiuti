import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { GetAuditTrailQuery } from '../../application/queries/get-audit-trail.query';
import { ReconstructHistoricalPermissionsQuery } from '../../application/queries/reconstruct-historical-permissions.query';
import { PermissionAuditLogRepository } from '../../domain/identity-access/permission-audit-log.repository.interface';
import { RoleChangeHistoryRepository } from '../../domain/identity-access/role-change-history.repository.interface';

/**
 * AuditController
 * T150-T155: API endpoints for audit trail retrieval
 *
 * Requirements from spec.md:
 * - US4 Acceptance Scenario 1-5: Compliance officer retrieves audit trails
 * - FR-018: Generate immutable audit reports for ARPA inspections
 * - 10-year retention per D.Lgs. 152/2006
 *
 * Endpoints:
 * - GET /api/v1/audit/permissions - Get all permission checks with filters
 * - GET /api/v1/audit/permissions/:userId - Get permission checks for specific user
 * - GET /api/v1/audit/permissions/resource/:resourceType/:resourceId - Get checks for resource
 * - GET /api/v1/audit/permissions/export - Export audit trail as CSV
 * - GET /api/v1/audit/role-changes - Get role change history
 * - POST /api/v1/audit/reconstruct-permissions - Reconstruct permissions at timestamp
 */
@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly auditLogRepository: PermissionAuditLogRepository,
    private readonly roleChangeHistoryRepository: RoleChangeHistoryRepository,
  ) {}

  /**
   * T150: GET /api/v1/audit/permissions
   * Retrieve permission audit trail with pagination and filtering
   *
   * Query Parameters:
   * - userId?: string - Filter by user ID
   * - startDate?: ISO date - Filter by start date
   * - endDate?: ISO date - Filter by end date
   * - decision?: 'ALLOW' | 'DENY' - Filter by decision
   * - resourceType?: string - Filter by resource type
   * - resourceId?: string - Filter by resource ID
   * - actionAttempted?: string - Filter by action
   * - page?: number - Page number (default: 1)
   * - pageSize?: number - Page size (default: 100, max: 1000)
   */
  @Get('permissions')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getAuditTrail(
    @Req() request: any,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('decision') decision?: 'ALLOW' | 'DENY',
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('actionAttempted') actionAttempted?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const tenantId = request.user.tenantId;

    const query = new GetAuditTrailQuery(
      tenantId,
      {
        userId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        decision,
        resourceType,
        resourceId,
        actionAttempted,
      },
      {
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
    );

    return await this.queryBus.execute(query);
  }

  /**
   * T151: GET /api/v1/audit/permissions/:userId
   * Retrieve permission checks for a specific user
   */
  @Get('permissions/:userId')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getAuditTrailForUser(
    @Req() request: any,
    @Param('userId') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const tenantId = request.user.tenantId;

    const query = new GetAuditTrailQuery(
      tenantId,
      {
        userId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
      {
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
    );

    return await this.queryBus.execute(query);
  }

  /**
   * T152: GET /api/v1/audit/permissions/resource/:resourceType/:resourceId
   * Retrieve permission checks for a specific resource
   */
  @Get('permissions/resource/:resourceType/:resourceId')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getAuditTrailForResource(
    @Req() request: any,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const tenantId = request.user.tenantId;

    const query = new GetAuditTrailQuery(
      tenantId,
      {
        resourceType,
        resourceId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
      {
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
    );

    return await this.queryBus.execute(query);
  }

  /**
   * T153: GET /api/v1/audit/permissions/export
   * Export audit trail as CSV for ARPA inspection
   *
   * Response:
   * - Content-Type: text/csv
   * - Content-Disposition: attachment; filename="audit-trail-{tenantId}-{date}.csv"
   */
  @Get('permissions/export')
  @RequirePermission('audit:export:all')
  @HttpCode(HttpStatus.OK)
  async exportAuditTrail(
    @Req() request: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
  ) {
    const tenantId = request.user.tenantId;

    const csv = await this.auditLogRepository.exportToCsv({
      tenantId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      userId,
    });

    // Set response headers for CSV download
    const filename = `audit-trail-${tenantId}-${new Date().toISOString().split('T')[0]}.csv`;

    return {
      data: csv,
      filename,
      contentType: 'text/csv',
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    };
  }

  /**
   * T154: GET /api/v1/audit/role-changes
   * Retrieve role change history with pagination and filtering
   *
   * Query Parameters:
   * - userId?: string - Filter by user whose role changed
   * - roleId?: string - Filter by role ID
   * - changedBy?: string - Filter by who made the change
   * - startDate?: ISO date - Filter by start date
   * - endDate?: ISO date - Filter by end date
   * - changeType?: 'INITIAL' | 'CHANGE' | 'REVOCATION' - Filter by change type
   * - page?: number - Page number (default: 1)
   * - pageSize?: number - Page size (default: 100, max: 1000)
   */
  @Get('role-changes')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getRoleChanges(
    @Req() request: any,
    @Query('userId') userId?: string,
    @Query('roleId') roleId?: string,
    @Query('changedBy') changedBy?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('changeType') changeType?: 'INITIAL' | 'CHANGE' | 'REVOCATION',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const tenantId = request.user.tenantId;

    const result = await this.roleChangeHistoryRepository.findWithFilters({
      tenantId,
      userId,
      roleId,
      changedBy,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      changeType,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });

    // Map domain entities to DTOs
    return {
      changes: result.changes.map((change) => ({
        id: change.id,
        userId: change.userId,
        tenantId: change.tenantId,
        oldRoleId: change.oldRoleId,
        newRoleId: change.newRoleId,
        changedBy: change.changedBy,
        reason: change.reason,
        timestamp: change.timestamp,
        effectiveDate: change.effectiveDate,
        changeType: change.isInitialAssignment()
          ? 'INITIAL'
          : change.isRevocation()
            ? 'REVOCATION'
            : 'CHANGE',
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * T155: POST /api/v1/audit/reconstruct-permissions
   * Reconstruct user permissions at a specific timestamp
   *
   * Body:
   * {
   *   userId: string,
   *   timestamp: ISO date string
   * }
   *
   * Response:
   * {
   *   userId: string,
   *   tenantId: string,
   *   timestamp: Date,
   *   roleId: string | null,
   *   roleName: string | null,
   *   permissions: string[],
   *   hadAccess: boolean
   * }
   */
  @Post('reconstruct-permissions')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async reconstructPermissions(
    @Req() request: any,
    @Body() body: { userId: string; timestamp: string },
  ) {
    const tenantId = request.user.tenantId;

    const query = new ReconstructHistoricalPermissionsQuery(
      body.userId,
      tenantId,
      new Date(body.timestamp),
    );

    return await this.queryBus.execute(query);
  }

  /**
   * GET /api/v1/audit/statistics
   * Get audit statistics for dashboard
   */
  @Get('statistics')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getAuditStatistics(
    @Req() request: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = request.user.tenantId;

    const [permissionStats, roleChangeStats] = await Promise.all([
      this.auditLogRepository.getStatistics(tenantId, {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      }),
      this.roleChangeHistoryRepository.getStatistics(tenantId, {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      }),
    ]);

    return {
      permissions: permissionStats,
      roleChanges: roleChangeStats,
    };
  }

  /**
   * GET /api/v1/audit/chain-integrity
   * Validate cryptographic chain integrity
   */
  @Get('chain-integrity')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async validateChainIntegrity(
    @Req() request: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = request.user.tenantId;

    const result = await this.auditLogRepository.validateChainIntegrity(
      tenantId,
      {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
    );

    return {
      isValid: result.isValid,
      totalLogs: result.totalLogs,
      firstInvalidLogId: result.firstInvalidLogId,
      error: result.error,
      message: result.isValid
        ? 'Audit log chain is valid (no tampering detected)'
        : `Chain integrity violation detected at log ${result.firstInvalidLogId}`,
    };
  }
}
