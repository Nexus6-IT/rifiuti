import { Role } from './role.entity'

/**
 * RoleRepository Interface
 * Per DDD patterns: Domain defines interface, Infrastructure implements
 *
 * Responsibilities:
 * - Persist and retrieve Role aggregates
 * - Enforce tenant isolation
 * - Support caching strategies
 */
export interface RoleRepository {
  /**
   * Find role by ID
   * @returns Role or null if not found
   */
  findById(roleId: string, tenantId: string): Promise<Role | null>

  /**
   * Find role by name within tenant
   * @returns Role or null if not found
   */
  findByName(roleName: string, tenantId: string): Promise<Role | null>

  /**
   * Find all roles for tenant
   * @param includeDeleted Whether to include soft-deleted roles
   * @returns Array of roles
   */
  findByTenant(tenantId: string, includeDeleted?: boolean): Promise<Role[]>

  /**
   * Find all system roles for tenant
   * @returns Array of system roles
   */
  findSystemRoles(tenantId: string): Promise<Role[]>

  /**
   * Find all custom (non-system) roles for tenant
   * @param includeDeleted Whether to include soft-deleted roles
   * @returns Array of custom roles
   */
  findCustomRoles(tenantId: string, includeDeleted?: boolean): Promise<Role[]>

  /**
   * Save role (create or update)
   * @returns Saved role
   */
  save(role: Role): Promise<Role>

  /**
   * Delete role (soft delete)
   * @throws Error if role is system role or last admin
   */
  delete(roleId: string, tenantId: string): Promise<void>

  /**
   * Check if role name exists in tenant
   * @param excludeRoleId Optional role ID to exclude from check (for updates)
   * @returns True if name exists
   */
  nameExists(roleName: string, tenantId: string, excludeRoleId?: string): Promise<boolean>

  /**
   * Count active users assigned to role
   * Used for last admin protection
   * @returns Number of active users with this role
   */
  countActiveUsers(roleId: string, tenantId: string): Promise<number>
}
