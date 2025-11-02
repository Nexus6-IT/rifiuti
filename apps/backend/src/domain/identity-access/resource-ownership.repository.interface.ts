import { ResourceOwnership } from './resource-ownership.entity';

/**
 * ResourceOwnership Repository Interface
 * T183: Repository interface for User Story 6 - Task Assignment Automation
 *
 * Purpose: Define contract for ResourceOwnership persistence operations
 *
 * Requirements from spec.md FR-029-032:
 * - Find active assignments for task routing
 * - Query by user ID (driver assignments)
 * - Query by resource ID (vehicle/facility assignments)
 * - Support tenant isolation
 * - Track assignment history
 *
 * Requirements from plan.md:
 * - Read-heavy operations (optimized queries)
 * - Support filtering by resource type
 * - Support filtering by active/expired status
 * - Fast lookups for task assignment routing (<10ms)
 */
export interface ResourceOwnershipRepository {
  /**
   * Save or update resource ownership
   */
  save(ownership: ResourceOwnership): Promise<ResourceOwnership>;

  /**
   * Find resource ownership by ID
   */
  findById(id: string, tenantId: string): Promise<ResourceOwnership | null>;

  /**
   * Find all active (non-expired, non-revoked) ownerships for a tenant
   * Used for task assignment routing
   */
  findActiveByTenant(
    tenantId: string,
    resourceType?: string,
  ): Promise<ResourceOwnership[]>;

  /**
   * Find all ownerships for a specific user
   * Includes both active and inactive assignments
   */
  findByUserId(
    userId: string,
    tenantId: string,
    activeOnly?: boolean,
  ): Promise<ResourceOwnership[]>;

  /**
   * Find all ownerships for a specific resource
   * Example: Find all drivers assigned to a specific vehicle
   */
  findByResourceId(
    resourceId: string,
    tenantId: string,
    activeOnly?: boolean,
  ): Promise<ResourceOwnership[]>;

  /**
   * Find active vehicle assignments with metadata (certifications, capacity)
   * Optimized query for task assignment routing
   */
  findActiveVehicleAssignments(
    tenantId: string,
    requiredCertifications?: string[],
    zone?: string,
  ): Promise<ResourceOwnership[]>;

  /**
   * Find assignments that expire within a given timeframe
   * Used for expiration notifications
   */
  findExpiringAssignments(
    tenantId: string,
    withinDays: number,
  ): Promise<ResourceOwnership[]>;

  /**
   * Check if a user has an active assignment for a specific resource type
   */
  hasActiveAssignment(
    userId: string,
    tenantId: string,
    resourceType: string,
  ): Promise<boolean>;

  /**
   * Get assignment history for a user
   * Includes deactivated assignments for audit purposes
   */
  getAssignmentHistory(
    userId: string,
    tenantId: string,
    limit?: number,
  ): Promise<ResourceOwnership[]>;

  /**
   * Deactivate all active assignments for a user
   * Used when removing a user or changing their role
   */
  deactivateAllForUser(
    userId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
  ): Promise<number>;

  /**
   * Deactivate all active assignments for a resource
   * Used when decommissioning a vehicle or closing a facility
   */
  deactivateAllForResource(
    resourceId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
  ): Promise<number>;

  /**
   * Delete a resource ownership (hard delete)
   * Only used for cleanup, not recommended for production
   */
  delete(id: string, tenantId: string): Promise<void>;
}
