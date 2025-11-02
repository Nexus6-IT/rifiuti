import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Logger,
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
import { RequestTemporaryPermissionCommand } from '../../application/commands/request-temporary-permission.command';
import { ApproveTemporaryPermissionCommand } from '../../application/commands/approve-temporary-permission.command';
import { RejectTemporaryPermissionCommand } from '../../application/commands/reject-temporary-permission.command';
import { RevokeTemporaryPermissionCommand } from '../../application/commands/revoke-temporary-permission.command';
import { TemporaryPermissionGrantRepository } from '../../domain/identity-access/temporary-permission-grant.repository.interface';

/**
 * TemporaryPermissionController
 * T208-T213: REST API for temporary permission grants per User Story 7
 *
 * Purpose: Expose temporary permission request/approval workflow
 *
 * Requirements from spec.md FR-033-036:
 * - POST /api/v1/permissions/request - Submit permission request
 * - GET /api/v1/permissions/pending - List pending (admin only)
 * - POST /api/v1/permissions/:id/approve - Approve grant
 * - POST /api/v1/permissions/:id/reject - Reject grant
 * - POST /api/v1/permissions/:id/revoke - Revoke active grant
 * - GET /api/v1/permissions/my-grants - List user's grants
 */
@Controller('api/v1/permissions')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class TemporaryPermissionController {
  private readonly logger = new Logger(TemporaryPermissionController.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly grantRepository: TemporaryPermissionGrantRepository,
  ) {}

  /**
   * T208: POST /api/v1/permissions/request
   * Submit temporary permission request
   * Requires: Any authenticated user (consultants, etc.)
   */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async requestPermission(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      permissions: string[];
      startTime: string; // ISO date string
      endTime: string; // ISO date string
      justification: string;
    },
  ) {
    this.logger.log(`User ${user.userId} requesting temporary permissions`);

    const command = new RequestTemporaryPermissionCommand(
      user.userId,
      tenantId,
      body.permissions,
      new Date(body.startTime),
      new Date(body.endTime),
      body.justification,
    );

    const grant = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        id: grant.id,
        status: grant.status,
        permissions: grant.permissions,
        startTime: grant.startTime.toISOString(),
        endTime: grant.endTime.toISOString(),
        requestedAt: grant.requestedAt.toISOString(),
      },
      message: 'Permission request submitted successfully. Awaiting approval.',
    };
  }

  /**
   * T209: GET /api/v1/permissions/pending
   * List all pending permission requests (admin view)
   * Requires: role:read:all permission (ADMIN only)
   */
  @Get('pending')
  @RequirePermission('role:read:all')
  async listPending(@CurrentTenant() tenantId: string) {
    this.logger.log(`Fetching pending permission requests for tenant ${tenantId}`);

    const pendingGrants = await this.grantRepository.findPendingByTenant(tenantId);

    return {
      success: true,
      data: {
        grants: pendingGrants.map((grant) => ({
          id: grant.id,
          userId: grant.userId,
          permissions: grant.permissions,
          startTime: grant.startTime.toISOString(),
          endTime: grant.endTime.toISOString(),
          justification: grant.justification,
          requestedBy: grant.requestedBy,
          requestedAt: grant.requestedAt.toISOString(),
        })),
        total: pendingGrants.length,
      },
      message: `Found ${pendingGrants.length} pending request(s)`,
    };
  }

  /**
   * T210: POST /api/v1/permissions/:id/approve
   * Approve temporary permission request
   * Requires: role:update:all permission (ADMIN only)
   */
  @Post(':id/approve')
  @RequirePermission('role:update:all')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') grantId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() body: { reason: string },
  ) {
    this.logger.log(`Admin ${user.userId} approving grant ${grantId}`);

    const command = new ApproveTemporaryPermissionCommand(
      grantId,
      tenantId,
      user.userId,
      body.reason,
    );

    const grant = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        id: grant.id,
        status: grant.status,
        approvedBy: grant.approvedBy,
        approvedAt: grant.approvedAt?.toISOString(),
      },
      message: 'Permission request approved successfully',
    };
  }

  /**
   * T211: POST /api/v1/permissions/:id/reject
   * Reject temporary permission request
   * Requires: role:update:all permission (ADMIN only)
   */
  @Post(':id/reject')
  @RequirePermission('role:update:all')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') grantId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() body: { reason: string },
  ) {
    this.logger.log(`Admin ${user.userId} rejecting grant ${grantId}`);

    const command = new RejectTemporaryPermissionCommand(
      grantId,
      tenantId,
      user.userId,
      body.reason,
    );

    const grant = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        id: grant.id,
        status: grant.status,
        approvedBy: grant.approvedBy,
        approvedAt: grant.approvedAt?.toISOString(),
        approvalReason: grant.approvalReason,
      },
      message: 'Permission request rejected',
    };
  }

  /**
   * T212: POST /api/v1/permissions/:id/revoke
   * Revoke active temporary permission grant
   * Requires: role:update:all permission (ADMIN only)
   */
  @Post(':id/revoke')
  @RequirePermission('role:update:all')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id') grantId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() body: { reason: string },
  ) {
    this.logger.log(`Admin ${user.userId} revoking grant ${grantId}`);

    const command = new RevokeTemporaryPermissionCommand(
      grantId,
      tenantId,
      user.userId,
      body.reason,
    );

    const grant = await this.commandBus.execute(command);

    return {
      success: true,
      data: {
        id: grant.id,
        status: grant.status,
        revokedBy: grant.revokedBy,
        revokedAt: grant.revokedAt?.toISOString(),
      },
      message: 'Permission grant revoked successfully',
    };
  }

  /**
   * T213: GET /api/v1/permissions/my-grants
   * List current user's permission grants (history)
   * Requires: Authenticated user
   */
  @Get('my-grants')
  async listMyGrants(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
  ) {
    this.logger.log(`User ${user.userId} fetching their grants`);

    const grants = await this.grantRepository.findAllByUser(user.userId, tenantId, 50);

    return {
      success: true,
      data: {
        grants: grants.map((grant) => ({
          id: grant.id,
          permissions: grant.permissions,
          startTime: grant.startTime.toISOString(),
          endTime: grant.endTime.toISOString(),
          justification: grant.justification,
          status: grant.status,
          requestedAt: grant.requestedAt.toISOString(),
          approvedBy: grant.approvedBy,
          approvedAt: grant.approvedAt?.toISOString(),
          approvalReason: grant.approvalReason,
          isActive: grant.isActive(),
          isExpired: grant.isExpired(),
        })),
        total: grants.length,
      },
      message: 'Your permission grants retrieved successfully',
    };
  }
}
