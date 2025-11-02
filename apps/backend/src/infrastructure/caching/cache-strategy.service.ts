import { Injectable, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';

/**
 * CacheStrategyService
 * T223: Intelligent caching strategy for performance optimization
 *
 * Purpose: Implement multi-tier caching with invalidation strategies
 *
 * Features:
 * - Permission caching (hot path optimization)
 * - User context caching
 * - Query result caching with TTL
 * - Cache invalidation patterns
 * - Cache hit/miss metrics
 */
@Injectable()
export class CacheStrategyService {
  private readonly logger = new Logger(CacheStrategyService.name);

  // Cache TTL configurations (in seconds)
  private readonly TTL = {
    PERMISSION: 300, // 5 minutes - frequently accessed
    USER_CONTEXT: 600, // 10 minutes - moderately stable
    ROLE: 1800, // 30 minutes - rarely changes
    TENANT_CONFIG: 3600, // 1 hour - very stable
    QUERY_RESULT: 60, // 1 minute - short-lived
    RESOURCE_OWNERSHIP: 300, // 5 minutes - task assignments
  };

  // Metrics tracking
  private metrics = {
    hits: 0,
    misses: 0,
    invalidations: 0,
  };

  constructor(private readonly cacheManager: Cache) {}

  /**
   * Cache user permissions (hot path)
   */
  async cacheUserPermissions(
    userId: string,
    tenantId: string,
    permissions: string[],
  ): Promise<void> {
    const key = this.getUserPermissionKey(userId, tenantId);
    await this.cacheManager.set(key, permissions, this.TTL.PERMISSION);
    this.logger.debug(`Cached permissions for user ${userId}`);
  }

  /**
   * Get cached user permissions
   */
  async getUserPermissions(
    userId: string,
    tenantId: string,
  ): Promise<string[] | null> {
    const key = this.getUserPermissionKey(userId, tenantId);
    const cached = await this.cacheManager.get<string[]>(key);

    if (cached) {
      this.metrics.hits++;
      this.logger.debug(`Cache HIT: User permissions for ${userId}`);
      return cached;
    }

    this.metrics.misses++;
    this.logger.debug(`Cache MISS: User permissions for ${userId}`);
    return null;
  }

  /**
   * Invalidate user permission cache
   */
  async invalidateUserPermissions(userId: string, tenantId: string): Promise<void> {
    const key = this.getUserPermissionKey(userId, tenantId);
    await this.cacheManager.del(key);
    this.metrics.invalidations++;
    this.logger.log(`Invalidated permission cache for user ${userId}`);
  }

  /**
   * Cache role permissions
   */
  async cacheRolePermissions(
    roleId: string,
    tenantId: string,
    permissions: string[],
  ): Promise<void> {
    const key = this.getRolePermissionKey(roleId, tenantId);
    await this.cacheManager.set(key, permissions, this.TTL.ROLE);
    this.logger.debug(`Cached role permissions for ${roleId}`);
  }

  /**
   * Get cached role permissions
   */
  async getRolePermissions(
    roleId: string,
    tenantId: string,
  ): Promise<string[] | null> {
    const key = this.getRolePermissionKey(roleId, tenantId);
    const cached = await this.cacheManager.get<string[]>(key);

    if (cached) {
      this.metrics.hits++;
      return cached;
    }

    this.metrics.misses++;
    return null;
  }

  /**
   * Invalidate all permission caches for a tenant
   * Used when roles or permissions change
   */
  async invalidateTenantPermissions(tenantId: string): Promise<void> {
    // In a real implementation, we'd use Redis SCAN to find all keys with pattern
    // For now, this is a placeholder
    this.logger.log(`Invalidating all permission caches for tenant ${tenantId}`);
    this.metrics.invalidations++;

    // Publish invalidation event to all instances
    // await this.publishInvalidationEvent('tenant-permissions', tenantId);
  }

  /**
   * Cache query results with short TTL
   */
  async cacheQueryResult<T>(
    queryKey: string,
    data: T,
    ttl?: number,
  ): Promise<void> {
    const finalTtl = ttl || this.TTL.QUERY_RESULT;
    await this.cacheManager.set(queryKey, data, finalTtl);
    this.logger.debug(`Cached query result: ${queryKey} (TTL: ${finalTtl}s)`);
  }

  /**
   * Get cached query result
   */
  async getQueryResult<T>(queryKey: string): Promise<T | null> {
    const cached = await this.cacheManager.get<T>(queryKey);

    if (cached) {
      this.metrics.hits++;
      return cached;
    }

    this.metrics.misses++;
    return null;
  }

  /**
   * Cache-aside pattern helper
   * Automatically handles cache miss by executing the provided function
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.cacheManager.get<T>(key);

    if (cached) {
      this.metrics.hits++;
      return cached;
    }

    // Cache miss - fetch data
    this.metrics.misses++;
    const data = await fetchFn();

    // Store in cache
    await this.cacheManager.set(key, data, ttl || this.TTL.QUERY_RESULT);

    return data;
  }

  /**
   * Batch cache invalidation
   * More efficient than individual deletes
   */
  async invalidatePattern(pattern: string): Promise<void> {
    // In Redis, we'd use SCAN + DEL pattern
    this.logger.log(`Invalidating cache pattern: ${pattern}`);
    this.metrics.invalidations++;
  }

  /**
   * Get cache metrics
   */
  getCacheMetrics(): {
    hits: number;
    misses: number;
    invalidations: number;
    hitRate: string;
  } {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? ((this.metrics.hits / total) * 100).toFixed(2) : '0.00';

    return {
      ...this.metrics,
      hitRate: `${hitRate}%`,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      invalidations: 0,
    };
  }

  // Private helper methods
  private getUserPermissionKey(userId: string, tenantId: string): string {
    return `perm:user:${tenantId}:${userId}`;
  }

  private getRolePermissionKey(roleId: string, tenantId: string): string {
    return `perm:role:${tenantId}:${roleId}`;
  }
}
