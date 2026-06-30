import { UserRole } from './user-role.entity'

/**
 * UserRoleRepository Interface
 * Per DDD patterns: Domain defines interface, Infrastructure implements
 *
 * Responsibilities:
 * - Persist and retrieve UserRole assignments
 * - Enforce tenant isolation
 * - Support expiration and facility-scoped queries
 */
export interface UserRoleRepository {
  /**
   * Find user role assignment by ID
   * @returns UserRole or null if not found
   */
  findById(userRoleId: string, tenantId: string): Promise<UserRole | null>

  /**
   * Find all active roles for user
   * Active = not expired AND not revoked
   * @returns Array of active user roles
   */
  findActiveByUserId(userId: string, tenantId: string): Promise<UserRole[]>

  /**
   * Find all roles for user (including inactive)
   * @returns Array of all user roles
   */
  findAllByUserId(userId: string, tenantId: string): Promise<UserRole[]>

  /**
   * Find specific role assignment for user
   * @returns UserRole or null if not found
   */
  findByUserIdAndRoleId(userId: string, roleId: string, tenantId: string): Promise<UserRole | null>

  /**
   * Find all users assigned to role
   * @param includeInactive Whether to include expired/revoked assignments
   * @returns Array of user roles
   */
  findByRoleId(roleId: string, tenantId: string, includeInactive?: boolean): Promise<UserRole[]>

  /**
   * Find facility-scoped roles for user and facility
   * @param userId User ID
   * @param facilityId Facility ID
   * @param tenantId Tenant ID
   * @returns Array of user roles scoped to facility
   */
  findByUserIdAndFacilityId(
    userId: string,
    facilityId: string,
    tenantId: string
  ): Promise<UserRole[]>

  /**
   * Find expiring roles (expiring within specified hours)
   * Used for sending expiration warnings
   * @param hoursAhead Number of hours to look ahead
   * @param tenantId Optional tenant ID to filter by
   * @returns Array of expiring user roles
   */
  findExpiringSoon(hoursAhead: number, tenantId?: string): Promise<UserRole[]>

  /**
   * Find expired roles that haven't been auto-revoked
   * Used by background job to auto-revoke
   * @returns Array of expired user roles
   */
  findExpiredNotRevoked(): Promise<UserRole[]>

  /**
   * Count active users with specific role in tenant
   * Used for last admin protection
   * @param roleId Role ID
   * @param tenantId Tenant ID
   * @returns Number of active users with role
   */
  countActiveAdmins(roleId: string, tenantId: string): Promise<number>

  /**
   * Save user role (create or update)
   * @returns Saved user role
   */
  save(userRole: UserRole): Promise<UserRole>

  /**
   * Revoke user role assignment
   * @param userRoleId User role ID
   * @param tenantId Tenant ID
   */
  revoke(userRoleId: string, tenantId: string): Promise<void>

  /**
   * Delete user role assignment (hard delete)
   * Generally prefer revoke() for audit trail
   * @param userRoleId User role ID
   * @param tenantId Tenant ID
   */
  delete(userRoleId: string, tenantId: string): Promise<void>

  /**
   * Bulk revoke all role assignments for user
   * Used when user is deactivated
   * @param userId User ID
   * @param tenantId Tenant ID
   * @returns Number of revoked assignments
   */
  revokeAllForUser(userId: string, tenantId: string): Promise<number>
}
