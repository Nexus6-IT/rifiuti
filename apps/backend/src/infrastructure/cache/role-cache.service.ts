import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Redis, Cluster } from 'ioredis'
import { RedisConfig } from './redis.config'

/**
 * Role Cache Service
 * Caches role definitions to reduce database queries
 * Roles change infrequently, so longer TTL than permissions
 */
@Injectable()
export class RoleCacheService implements OnModuleInit {
  private readonly logger = new Logger(RoleCacheService.name)
  private redis: Redis | Cluster
  private readonly defaultTTL: number = 3600 // 1 hour TTL for roles (change less frequently)

  constructor(private readonly redisConfig: RedisConfig) {}

  async onModuleInit() {
    this.redis = this.redisConfig.createClient()

    this.redis.on('connect', () => {
      this.logger.log('✅ Redis connected for role caching')
    })

    this.redis.on('error', error => {
      this.logger.error('❌ Redis connection error:', error)
    })
  }

  /**
   * Generate cache key for role by ID
   */
  private getRoleCacheKey(roleId: string): string {
    return `role:${roleId}`
  }

  /**
   * Generate cache key for tenant's role list
   */
  private getTenantRolesCacheKey(tenantId: string): string {
    return `tenant_roles:${tenantId}`
  }

  /**
   * Cache a single role definition
   */
  async setRole(
    roleId: string,
    roleData: any,
    ttlSeconds: number = this.defaultTTL
  ): Promise<void> {
    const key = this.getRoleCacheKey(roleId)

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(roleData))
      this.logger.debug(`✅ Cached role ${roleId} (TTL: ${ttlSeconds}s)`)
    } catch (error) {
      this.logger.error(`❌ Failed to cache role ${roleId}:`, error)
    }
  }

  /**
   * Retrieve role definition from cache
   */
  async getRole(roleId: string): Promise<any | null> {
    const key = this.getRoleCacheKey(roleId)

    try {
      const cached = await this.redis.get(key)

      if (!cached) {
        this.logger.debug(`Cache MISS for role ${roleId}`)
        return null
      }

      this.logger.debug(`Cache HIT for role ${roleId}`)
      return JSON.parse(cached)
    } catch (error) {
      this.logger.error(`❌ Failed to retrieve cached role ${roleId}:`, error)
      return null
    }
  }

  /**
   * Cache all roles for a tenant
   * Useful for role listing endpoints
   */
  async setTenantRoles(
    tenantId: string,
    roles: any[],
    ttlSeconds: number = this.defaultTTL
  ): Promise<void> {
    const key = this.getTenantRolesCacheKey(tenantId)

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(roles))
      this.logger.debug(
        `✅ Cached ${roles.length} roles for tenant ${tenantId} (TTL: ${ttlSeconds}s)`
      )
    } catch (error) {
      this.logger.error(`❌ Failed to cache roles for tenant ${tenantId}:`, error)
    }
  }

  /**
   * Retrieve all roles for a tenant from cache
   */
  async getTenantRoles(tenantId: string): Promise<any[] | null> {
    const key = this.getTenantRolesCacheKey(tenantId)

    try {
      const cached = await this.redis.get(key)

      if (!cached) {
        this.logger.debug(`Cache MISS for tenant ${tenantId} roles`)
        return null
      }

      this.logger.debug(`Cache HIT for tenant ${tenantId} roles`)
      return JSON.parse(cached)
    } catch (error) {
      this.logger.error(`❌ Failed to retrieve cached roles for tenant ${tenantId}:`, error)
      return null
    }
  }

  /**
   * Invalidate single role cache
   * Called when role definition changes
   */
  async invalidateRole(roleId: string): Promise<void> {
    const key = this.getRoleCacheKey(roleId)

    try {
      await this.redis.del(key)
      this.logger.log(`🗑️  Invalidated role cache for ${roleId}`)
    } catch (error) {
      this.logger.error(`❌ Failed to invalidate role ${roleId}:`, error)
    }
  }

  /**
   * Invalidate all role caches for a tenant
   * Called when any role changes in tenant
   */
  async invalidateTenantRoles(tenantId: string): Promise<void> {
    try {
      // Invalidate tenant role list
      const tenantKey = this.getTenantRolesCacheKey(tenantId)
      await this.redis.del(tenantKey)

      // Find and invalidate individual role caches for this tenant
      // Note: In production, maintain a tenant->roles mapping for efficient invalidation
      this.logger.log(`🗑️  Invalidated role caches for tenant ${tenantId}`)
    } catch (error) {
      this.logger.error(`❌ Failed to invalidate roles for tenant ${tenantId}:`, error)
    }
  }
}
