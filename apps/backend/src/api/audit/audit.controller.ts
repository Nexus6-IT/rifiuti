import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { GetAuditTrailQuery } from '../../application/queries/get-audit-trail.query';
import { ReconstructHistoricalPermissionsQuery } from '../../application/queries/reconstruct-historical-permissions.query';

/**
 * AuditController
 * REST API for audit trail and compliance queries
 * T150-T155: Audit controller endpoints per User Story 4
 *
 * Purpose: Provide API access to audit logs for compliance officers
 *
 * Requirements from spec.md FR-018:
 * - GET audit trail with filters
 * - Export to CSV for ARPA inspections
 * - Get role changes history
 * - Reconstruct historical permissions
 * - Get audit statistics
 * - Validate chain integrity
 *
 * Requirements from plan.md:
 * - <500ms P95 latency for queries
 * - Require ADMIN or COMPLIANCE_OFFICER role
 * - Support pagination
 */
@Controller('api/v1/audit')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly queryBus: QueryBus) {}

  /**
   * T150: GET /api/v1/audit/permissions
   * Get audit trail with filters
   */
  @Get('permissions')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getAuditTrail(
    @CurrentUser() user: any,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('decision') decision?: 'ALLOW' | 'DENY',
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('actionAttempted') actionAttempted?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<any> {
    try {
      const query = new GetAuditTrailQuery(
        user.tenantId,
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

      const result = await this.queryBus.execute(query);

      this.logger.log(
        `Audit trail query completed: ${result.total} logs found in ${result.performanceMetrics?.queryTimeMs.toFixed(2)}ms`,
      );

      return {
        success: true,
        data: {
          logs: result.logs.map((log: any) => ({
            id: log.id,
            userId: log.userId,
            tenantId: log.tenantId,
            actionAttempted: log.actionAttempted,
            resourceType: log.resourceType,
            resourceId: log.resourceId,
            decision: log.decision,
            reason: log.reason,
            spidFiscalCode: log.spidFiscalCode,
            sessionId: log.sessionId,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            timestamp: log.timestamp,
            hash: log.hash,
            previousHash: log.previousHash,
          })),
          pagination: {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            totalPages: result.pageSize
              ? Math.ceil(result.total / result.pageSize)
              : 1,
          },
          performanceMetrics: result.performanceMetrics,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get audit trail: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * T151: GET /api/v1/audit/permissions/export
   * Export audit trail to CSV for ARPA inspection
   */
  @Get('permissions/export')
  @RequirePermission('audit:export:all')
  @HttpCode(HttpStatus.OK)
  async exportAuditTrail(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<void> {
    try {
      this.logger.log(`Exporting audit trail for tenant ${user.tenantId}`);

      // Use repository directly for CSV export
      // TODO: Inject PermissionAuditLogRepository
      const csv = 'id,timestamp,userId,decision\n'; // Placeholder

      const filename = `audit-trail-${user.tenantId}-${new Date().toISOString()}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      this.logger.error(`Failed to export audit trail: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * T152: GET /api/v1/audit/role-changes
   * Get role changes history
   */
  @Get('role-changes')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getRoleChanges(
    @CurrentUser() user: any,
    @Query('userId') userId?: string,
    @Query('roleId') roleId?: string,
    @Query('changedBy') changedBy?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('changeType') changeType?: 'INITIAL' | 'CHANGE' | 'REVOCATION',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<any> {
    try {
      // TODO: Create GetRoleChangesQuery and handler
      // For now, return placeholder

      this.logger.log(`Get role changes for tenant ${user.tenantId}`);

      return {
        success: true,
        data: {
          changes: [],
          pagination: {
            total: 0,
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 50,
            totalPages: 0,
          },
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get role changes: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * T153: POST /api/v1/audit/reconstruct
   * Reconstruct historical permissions for a user at a specific timestamp
   */
  @Post('reconstruct')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async reconstructHistoricalPermissions(
    @CurrentUser() user: any,
    @Body() body: { userId: string; timestamp: string },
  ): Promise<any> {
    try {
      this.logger.log(
        `Reconstructing permissions for user ${body.userId} at ${body.timestamp}`,
      );

      const query = new ReconstructHistoricalPermissionsQuery(
        body.userId,
        user.tenantId,
        new Date(body.timestamp),
      );

      const result = await this.queryBus.execute(query);

      return {
        success: true,
        data: {
          userId: result.userId,
          tenantId: result.tenantId,
          timestamp: result.timestamp,
          roleId: result.roleId,
          roleName: result.roleName,
          permissions: result.permissions,
          hadAccess: result.hadAccess,
          reconstructionMetadata: result.reconstructionMetadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to reconstruct historical permissions: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * T154: GET /api/v1/audit/stats
   * Get audit statistics for dashboard
   */
  @Get('stats')
  @RequirePermission('audit:read:all')
  @HttpCode(HttpStatus.OK)
  async getAuditStatistics(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<any> {
    try {
      this.logger.log(`Get audit statistics for tenant ${user.tenantId}`);

      // TODO: Inject repository and call getStatistics
      // For now, return placeholder

      return {
        success: true,
        data: {
          totalLogs: 0,
          allowedCount: 0,
          deniedCount: 0,
          uniqueUsers: 0,
          topDeniedActions: [],
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get audit statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * T155: POST /api/v1/audit/validate-chain
   * Validate cryptographic chain integrity
   */
  @Post('validate-chain')
  @RequirePermission('audit:validate:all')
  @HttpCode(HttpStatus.OK)
  async validateChainIntegrity(
    @CurrentUser() user: any,
    @Body() body: { startDate?: string; endDate?: string },
  ): Promise<any> {
    try {
      this.logger.log(
        `Validating chain integrity for tenant ${user.tenantId}`,
      );

      // TODO: Inject repository and call validateChainIntegrity
      // For now, return placeholder

      return {
        success: true,
        data: {
          isValid: true,
          totalLogs: 0,
          firstInvalidLogId: null,
          error: null,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to validate chain integrity: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
