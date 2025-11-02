import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, Cluster } from 'ioredis';
import { createHmac } from 'crypto';
import { RedisConfig } from './redis.config';

/**
 * Permission Cache Service
 * High-performance caching for user permissions with security (HMAC signing)
 * Target: >95% cache hit rate, <10ms P99 lookup per plan.md
 */
@Injectable()
export class PermissionCacheService implements OnModuleInit {
  private readonly logger = new Logger(PermissionCacheService.name);
  private redis: Redis | Cluster;
  private readonly hmacSecret: string;
  private readonly defaultTTL: number = 300; // 5 minutes default TTL per plan.md

  constructor(
    private readonly redisConfig: RedisConfig,
    private readonly configService: ConfigService,
  ) {
    // HMAC secret for cache entry signing (prevents cache poisoning attacks per plan.md FR-036)
    this.hmacSecret = this.configService.get<string>(
      'PERMISSION_CACHE_HMAC_SECRET',
      'change-me-in-production',
    );

    if (this.hmacSecret === 'change-me-in-production') {
      this.logger.warn(
        '⚠️  Using default HMAC secret - SET PERMISSION_CACHE_HMAC_SECRET in production!',
      );
    }
  }

  async onModuleInit() {
    this.redis = this.redisConfig.createClient();

    this.redis.on('connect', () => {
      this.logger.log('✅ Redis connected for permission caching');
    });

    this.redis.on('error', (error) => {
      this.logger.error('❌ Redis connection error:', error);
    });

    const info = this.redisConfig.getConnectionInfo();
    this.logger.log(
      `🔧 Permission cache initialized: ${info.mode} mode with ${info.nodes.length} node(s)`,
    );
  }

  /**
   * Generate tenant-scoped cache key
   * Format: permissions:{tenantId}:{userId}
   */
  private getCacheKey(tenantId: string, userId: string): string {
    return `permissions:${tenantId}:${userId}`;
  }

  /**
   * Generate HMAC signature for cache entry (prevents tampering)
   * Signs: tenantId + userId + permissions JSON
   */
  private generateSignature(
    tenantId: string,
    userId: string,
    permissions: string[],
  ): string {
    const data = `${tenantId}:${userId}:${JSON.stringify(permissions)}`;
    return createHmac('sha256', this.hmacSecret).update(data).digest('hex');
  }

  /**
   * Verify HMAC signature of cached entry
   */
  private verifySignature(
    tenantId: string,
    userId: string,
    permissions: string[],
    signature: string,
  ): boolean {
    const expected = this.generateSignature(tenantId, userId, permissions);
    return signature === expected;
  }

  /**
   * Store user permissions in cache with HMAC signature
   * @param tenantId - Tenant context
   * @param userId - User ID
   * @param permissions - Array of permission strings (e.g., ["fir:create:facility", "report:read:all"])
   * @param ttlSeconds - Time to live in seconds (default: 300s = 5 minutes)
   */
  async setPermissions(
    tenantId: string,
    userId: string,
    permissions: string[],
    ttlSeconds: number = this.defaultTTL,
  ): Promise<void> {
    const key = this.getCacheKey(tenantId, userId);
    const signature = this.generateSignature(tenantId, userId, permissions);

    const cacheValue = {
      permissions,
      signature,
      cachedAt: Date.now(),
      tenantId, // Store for verification
      userId, // Store for verification
    };

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(cacheValue));
      this.logger.debug(
        `✅ Cached permissions for user ${userId} in tenant ${tenantId} (${permissions.length} permissions, TTL: ${ttlSeconds}s)`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to cache permissions for user ${userId}:`,
        error,
      );
      // Don't throw - cache failure should not break permission checks
    }
  }

  /**
   * Retrieve user permissions from cache with signature verification
   * @returns Permissions array if valid cached entry exists, null otherwise
   */
  async getPermissions(
    tenantId: string,
    userId: string,
  ): Promise<string[] | null> {
    const key = this.getCacheKey(tenantId, userId);

    try {
      const cached = await this.redis.get(key);

      if (!cached) {
        this.logger.debug(`Cache MISS for user ${userId} in tenant ${tenantId}`);
        return null;
      }

      const cacheValue = JSON.parse(cached);

      // Verify tenant and user match (defense against key collision)
      if (
        cacheValue.tenantId !== tenantId ||
        cacheValue.userId !== userId
      ) {
        this.logger.warn(
          `⚠️  Cache key collision detected for user ${userId} - invalidating entry`,
        );
        await this.invalidateUser(tenantId, userId);
        return null;
      }

      // Verify HMAC signature (defense against cache poisoning)
      const isValid = this.verifySignature(
        tenantId,
        userId,
        cacheValue.permissions,
        cacheValue.signature,
      );

      if (!isValid) {
        this.logger.warn(
          `⚠️  Invalid signature for cached permissions of user ${userId} - possible tampering attempt`,
        );
        await this.invalidateUser(tenantId, userId);
        return null;
      }

      this.logger.debug(
        `Cache HIT for user ${userId} in tenant ${tenantId} (${cacheValue.permissions.length} permissions)`,
      );
      return cacheValue.permissions;
    } catch (error) {
      this.logger.error(
        `❌ Failed to retrieve cached permissions for user ${userId}:`,
        error,
      );
      return null; // Fail open - return null to trigger database lookup
    }
  }

  /**
   * Invalidate cached permissions for specific user
   * Called when user roles change
   */
  async invalidateUser(tenantId: string, userId: string): Promise<void> {
    const key = this.getCacheKey(tenantId, userId);

    try {
      await this.redis.del(key);
      this.logger.log(
        `🗑️  Invalidated permission cache for user ${userId} in tenant ${tenantId}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to invalidate cache for user ${userId}:`,
        error,
      );
    }
  }

  /**
   * Invalidate all cached permissions for a tenant
   * Called when role definitions change for tenant
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    const pattern = `permissions:${tenantId}:*`;

    try {
      const keys = await this.scanKeys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(
          `🗑️  Invalidated ${keys.length} permission cache entries for tenant ${tenantId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to invalidate cache for tenant ${tenantId}:`,
        error,
      );
    }
  }

  /**
   * Scan for keys matching pattern (works with cluster)
   * Uses SCAN to avoid blocking Redis
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const reply = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = reply[0];
      keys.push(...reply[1]);
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Get cache statistics for monitoring
   */
  async getStats(): Promise<{
    totalKeys: number;
    hitRate: number;
    memoryUsage: string;
  }> {
    try {
      const info = await this.redis.info('stats');
      const keyspace = await this.redis.info('keyspace');

      // Parse keyspace info for total keys
      const dbMatch = keyspace.match(/keys=(\d+)/);
      const totalKeys = dbMatch ? parseInt(dbMatch[1], 10) : 0;

      // Parse stats for hit rate
      const hitsMatch = info.match(/keyspace_hits:(\d+)/);
      const missesMatch = info.match(/keyspace_misses:(\d+)/);
      const hits = hitsMatch ? parseInt(hitsMatch[1], 10) : 0;
      const misses = missesMatch ? parseInt(missesMatch[1], 10) : 0;
      const hitRate =
        hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

      // Get memory usage
      const memInfo = await this.redis.info('memory');
      const memMatch = memInfo.match(/used_memory_human:(.+)/);
      const memoryUsage = memMatch ? memMatch[1].trim() : 'unknown';

      return {
        totalKeys,
        hitRate: Math.round(hitRate * 100) / 100,
        memoryUsage,
      };
    } catch (error) {
      this.logger.error('❌ Failed to retrieve cache stats:', error);
      return { totalKeys: 0, hitRate: 0, memoryUsage: 'unknown' };
    }
  }
}
