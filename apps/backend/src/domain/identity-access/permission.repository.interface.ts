import { Permission } from './permission.entity';

/**
 * PermissionRepository Interface
 * Per DDD patterns: Domain defines interface, Infrastructure implements
 *
 * Responsibilities:
 * - Persist and retrieve Permission aggregates
 * - Support bulk operations for role-permission assignments
 * - Enable efficient permission lookups
 */
export interface PermissionRepository {
  /**
   * Find permission by ID
   * @returns Permission or null if not found
   */
  findById(permissionId: string): Promise<Permission | null>;

  /**
   * Find permission by resource:action:scope format
   * @returns Permission or null if not found
   */
  findByString(permissionString: string): Promise<Permission | null>;

  /**
   * Find all permissions by module
   * @param module Module name (FIR, Facility, User, etc.)
   * @returns Array of permissions
   */
  findByModule(module: string): Promise<Permission[]>;

  /**
   * Find all permissions
   * @returns Array of all permissions
   */
  findAll(): Promise<Permission[]>;

  /**
   * Find permissions by IDs
   * @param permissionIds Array of permission IDs
   * @returns Array of permissions
   */
  findByIds(permissionIds: string[]): Promise<Permission[]>;

  /**
   * Find permissions for specific role
   * @param roleId Role ID
   * @returns Array of permissions assigned to role
   */
  findByRole(roleId: string): Promise<Permission[]>;

  /**
   * Find sensitive permissions (delete, approve, configure)
   * @returns Array of sensitive permissions
   */
  findSensitive(): Promise<Permission[]>;

  /**
   * Save permission (create or update)
   * @returns Saved permission
   */
  save(permission: Permission): Promise<Permission>;

  /**
   * Bulk create permissions
   * Used during seeding
   * @returns Array of created permissions
   */
  bulkCreate(permissions: Permission[]): Promise<Permission[]>;

  /**
   * Check if permission string exists
   * @param permissionString Format: resource:action:scope
   * @returns True if permission exists
   */
  exists(permissionString: string): Promise<boolean>;
}
