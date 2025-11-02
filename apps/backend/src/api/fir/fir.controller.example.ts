import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantIsolationGuard } from '../guards/tenant-isolation.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { SpidStepUpGuard } from '../guards/spid-step-up.guard';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { AuditAction } from '../decorators/audit-action.decorator';
import { CurrentTenant } from '../decorators/current-tenant.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';

/**
 * FIR Controller Example
 * Demonstrates integration of PermissionGuard with existing FIR endpoints
 * Per plan.md FR-001: ABAC enforcement on all endpoints
 *
 * THIS IS AN EXAMPLE - Full FIR controller implementation is in feature 001
 *
 * Key Integration Points:
 * 1. Apply JwtAuthGuard, TenantIsolationGuard, PermissionGuard to all endpoints
 * 2. Use @RequirePermission decorator with resource:action:scope format
 * 3. Use @AuditAction for sensitive operations
 * 4. Use SpidStepUpGuard for high-risk operations (delete, approve)
 */
@Controller('api/v1/fir')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class FirControllerExample {
  /**
   * GET /api/v1/fir
   * List FIRs - requires read permission
   */
  @Get()
  @RequirePermission('fir:read:facility')
  async listFirs(
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    // Implementation fetches FIRs based on user's facility scope
    return { firs: [] };
  }

  /**
   * POST /api/v1/fir
   * Create FIR - requires create permission
   */
  @Post()
  @RequirePermission('fir:create:facility')
  @AuditAction('create_fir')
  async createFir(
    @Body() dto: any,
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    // Implementation creates FIR
    return { id: 'new-fir-id' };
  }

  /**
   * PUT /api/v1/fir/:id
   * Update FIR - requires update permission
   */
  @Put(':id')
  @RequirePermission('fir:update:facility')
  @AuditAction('update_fir')
  async updateFir(
    @Param('id') firId: string,
    @Body() dto: any,
    @CurrentTenant() tenantId: string,
  ) {
    // Implementation updates FIR
    return { id: firId };
  }

  /**
   * DELETE /api/v1/fir/:id
   * Delete FIR - requires delete permission + SPID step-up auth
   *
   * NOTE: SpidStepUpGuard requires SPID re-authentication if >15 minutes
   */
  @Delete(':id')
  @UseGuards(SpidStepUpGuard) // Additional guard for sensitive operation
  @RequirePermission('fir:delete:facility')
  @AuditAction('delete_fir')
  async deleteFir(
    @Param('id') firId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    // Implementation deletes FIR
    return { deleted: true };
  }

  /**
   * POST /api/v1/fir/:id/approve
   * Approve FIR - requires approve permission + SPID step-up auth
   */
  @Post(':id/approve')
  @UseGuards(SpidStepUpGuard)
  @RequirePermission('fir:approve:facility')
  @AuditAction('approve_fir')
  async approveFir(
    @Param('id') firId: string,
    @CurrentTenant() tenantId: string,
  ) {
    // Implementation approves FIR
    return { approved: true };
  }
}

/**
 * Integration Notes:
 *
 * 1. Guard Order Matters:
 *    - JwtAuthGuard: Validates JWT token, extracts user context
 *    - TenantIsolationGuard: Validates tenant in route params matches JWT
 *    - PermissionGuard: Checks user has required permission
 *    - SpidStepUpGuard: (optional) Enforces re-authentication for sensitive ops
 *
 * 2. Permission Format:
 *    - resource:action:scope
 *    - Examples: "fir:read:facility", "fir:delete:all", "user:manage:all"
 *
 * 3. Scope Hierarchy:
 *    - "own" < "facility" < "all"
 *    - User with "fir:read:all" can access "fir:read:facility" endpoints
 *    - User with "fir:read:facility" CANNOT access "fir:read:all" endpoints
 *
 * 4. Audit Actions:
 *    - Always use @AuditAction for state-changing operations
 *    - Logged to PermissionAuditLog for compliance
 *
 * 5. Error Handling:
 *    - ForbiddenException thrown by PermissionGuard
 *    - Caught by PermissionExceptionFilter
 *    - Returns contextual error message to user
 */
