/**
 * Base repository interface following Domain-Driven Design principles
 *
 * All domain repositories should extend this interface to ensure
 * consistent data access patterns across aggregates.
 *
 * Type Parameters:
 * - T: The aggregate root or entity type
 * - ID: The identifier type (usually string UUID)
 */
export interface IRepository<T, ID = string> {
  /**
   * Find an entity by its unique identifier
   * @param id - The entity identifier
   * @returns The entity if found, null otherwise
   */
  findById(id: ID): Promise<T | null>

  /**
   * Find all entities matching the given criteria
   * @param criteria - Filter criteria (implementation-specific)
   * @returns Array of matching entities
   */
  findAll(criteria?: any): Promise<T[]>

  /**
   * Find entities with pagination
   * @param limit - Maximum number of entities to return
   * @param offset - Number of entities to skip
   * @param criteria - Optional filter criteria
   * @returns Paginated result with entities and total count
   */
  findPaginated(
    limit: number,
    offset: number,
    criteria?: any
  ): Promise<{ data: T[]; total: number }>

  /**
   * Save a new entity to the repository
   * @param entity - The entity to save
   * @returns The saved entity with generated ID
   */
  save(entity: T): Promise<T>

  /**
   * Update an existing entity
   * @param id - The entity identifier
   * @param entity - The updated entity data
   * @returns The updated entity
   */
  update(id: ID, entity: Partial<T>): Promise<T>

  /**
   * Delete an entity by its identifier
   * @param id - The entity identifier
   * @returns True if deleted, false if not found
   */
  delete(id: ID): Promise<boolean>

  /**
   * Check if an entity exists by its identifier
   * @param id - The entity identifier
   * @returns True if exists, false otherwise
   */
  exists(id: ID): Promise<boolean>

  /**
   * Count total entities matching criteria
   * @param criteria - Optional filter criteria
   * @returns Total count
   */
  count(criteria?: any): Promise<number>
}

/**
 * Repository interface for aggregates with tenant isolation
 *
 * Extends base repository with tenant-specific operations.
 * All queries are automatically scoped to the current tenant.
 */
export interface ITenantRepository<T, ID = string> extends IRepository<T, ID> {
  /**
   * Get the current tenant ID for this repository instance
   */
  getTenantId(): string

  /**
   * Find entities within the current tenant
   * Automatically applies tenantId filter
   */
  findByTenant(criteria?: any): Promise<T[]>
}
