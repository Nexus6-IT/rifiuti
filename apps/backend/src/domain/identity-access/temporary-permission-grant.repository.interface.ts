import { TemporaryPermissionGrant } from './temporary-permission-grant.entity';

/**
 * TemporaryPermissionGrant Repository Interface
 * T198: Repository interface for User Story 7 - Temporary Permission Requests
 *
 * Purpose: Define contract for TemporaryPermissionGrant persistence operations
 *
 * Requirements from spec.md FR-033-036:
 * - Find pending grants for approval
 * - Find active grants for permission checking
 * - Find grants by user for history
 * - Support tenant isolation
 * - Track approval workflow
 *
 * Requirements from plan.md:
 * - Fast active grant lookups (<5ms)
 * - Support filtering by status
 * - Find grants expiring soon for notifications
 * - Prevent overlapping grants for same user/permissions
 */
export interface TemporaryPermissionGrantRepository {
  /**
   * Save or update temporary permission grant
   */
  save(grant: TemporaryPermissionGrant): Promise<TemporaryPermissionGrant>;

  /**
   * Find grant by ID
   */
  findById(id: string, tenantId: string): Promise<TemporaryPermissionGrant | null>;

  /**
   * Find all pending grants for a tenant
   * Used by admins to see what needs approval
   */
  findPendingByTenant(tenantId: string): Promise<TemporaryPermissionGrant[]>;

  /**
   * Find all active grants for a user
   * Used for permission checking
   */
  findActiveByUser(
    userId: string,
    tenantId: string,
  ): Promise<TemporaryPermissionGrant[]>;

  /**
   * Find all grants for a user (any status)
   * Used for history/audit purposes
   */
  findAllByUser(
    userId: string,
    tenantId: string,
    limit?: number,
  ): Promise<TemporaryPermissionGrant[]>;

  /**
   * Find grants expiring within a timeframe
   * Used for expiration notifications
   */
  findExpiringGrants(
    tenantId: string,
    withinHours: number,
  ): Promise<TemporaryPermissionGrant[]>;

  /**
   * Check if user has overlapping active grant
   * Prevents multiple grants for same permissions
   */
  hasOverlappingGrant(
    userId: string,
    tenantId: string,
    permissions: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<boolean>;

  /**
   * Get grant statistics for tenant
   * Used for dashboard/reporting
   */
  getGrantStatistics(tenantId: string): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    active: number;
    expired: number;
  }>;

  /**
   * Delete a grant (hard delete)
   * Only used for cleanup
   */
  delete(id: string, tenantId: string): Promise<void>;

  /**
   * Find grants that need expiration (past endTime, not auto-revoked)
   * Used by background expiration job
   */
  findGrantsNeedingExpiration(tenantId?: string): Promise<TemporaryPermissionGrant[]>;
}
