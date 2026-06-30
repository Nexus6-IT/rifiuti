import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Redis, Cluster } from 'ioredis'
import { RedisConfig } from './redis.config'
import { PermissionCacheService } from './permission-cache.service'
import { RoleCacheService } from './role-cache.service'

/**
 * Redis Pub/Sub Service for Cache Invalidation
 * Broadcasts cache invalidation events across all service instances
 * Essential for multi-instance deployments per plan.md
 */

interface CacheInvalidationMessage {
  type: 'user' | 'tenant' | 'role'
  tenantId?: string
  userId?: string
  roleId?: string
  timestamp: number
  instanceId: string
}

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name)
  private publisher: Redis | Cluster
  private subscriber: Redis | Cluster
  private readonly instanceId: string
  private readonly channel = 'permission:cache:invalidate'

  constructor(
    private readonly redisConfig: RedisConfig,
    private readonly permissionCache: PermissionCacheService,
    private readonly roleCache: RoleCacheService
  ) {
    // Generate unique instance ID for this service instance
    this.instanceId = `${process.env.HOSTNAME || 'unknown'}-${process.pid}`
  }

  async onModuleInit() {
    // Create separate connections for pub and sub (recommended pattern)
    this.publisher = this.redisConfig.createPubSubClient()
    this.subscriber = this.redisConfig.createPubSubClient()

    this.publisher.on('connect', () => {
      this.logger.log('✅ Redis publisher connected')
    })

    this.subscriber.on('connect', () => {
      this.logger.log('✅ Redis subscriber connected')
    })

    this.publisher.on('error', error => {
      this.logger.error('❌ Redis publisher error:', error)
    })

    this.subscriber.on('error', error => {
      this.logger.error('❌ Redis subscriber error:', error)
    })

    // Subscribe to cache invalidation channel
    await this.subscriber.subscribe(this.channel)
    this.logger.log(`📡 Subscribed to cache invalidation channel: ${this.channel}`)

    // Handle incoming invalidation messages
    this.subscriber.on('message', async (channel, message) => {
      if (channel === this.channel) {
        await this.handleInvalidationMessage(message)
      }
    })

    this.logger.log(`🚀 Pub/Sub service initialized with instance ID: ${this.instanceId}`)
  }

  async onModuleDestroy() {
    await this.subscriber.unsubscribe(this.channel)
    await this.subscriber.quit()
    await this.publisher.quit()
    this.logger.log('🛑 Pub/Sub service shut down')
  }

  /**
   * Publish user permission invalidation
   * Notifies all service instances to clear cache for specific user
   */
  async publishUserInvalidation(tenantId: string, userId: string): Promise<void> {
    const message: CacheInvalidationMessage = {
      type: 'user',
      tenantId,
      userId,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    }

    try {
      await this.publisher.publish(this.channel, JSON.stringify(message))
      this.logger.debug(`📤 Published user invalidation: ${userId} in tenant ${tenantId}`)
    } catch (error) {
      this.logger.error('❌ Failed to publish user invalidation:', error)
    }
  }

  /**
   * Publish tenant-wide cache invalidation
   * Notifies all service instances to clear cache for entire tenant
   */
  async publishTenantInvalidation(tenantId: string): Promise<void> {
    const message: CacheInvalidationMessage = {
      type: 'tenant',
      tenantId,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    }

    try {
      await this.publisher.publish(this.channel, JSON.stringify(message))
      this.logger.debug(`📤 Published tenant invalidation: ${tenantId}`)
    } catch (error) {
      this.logger.error('❌ Failed to publish tenant invalidation:', error)
    }
  }

  /**
   * Publish role definition invalidation
   * Notifies all service instances to clear cache for specific role
   */
  async publishRoleInvalidation(roleId: string, tenantId: string): Promise<void> {
    const message: CacheInvalidationMessage = {
      type: 'role',
      roleId,
      tenantId,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    }

    try {
      await this.publisher.publish(this.channel, JSON.stringify(message))
      this.logger.debug(`📤 Published role invalidation: ${roleId}`)
    } catch (error) {
      this.logger.error('❌ Failed to publish role invalidation:', error)
    }
  }

  /**
   * Handle received invalidation message
   * Process cache invalidation on this instance
   */
  private async handleInvalidationMessage(message: string): Promise<void> {
    try {
      const msg: CacheInvalidationMessage = JSON.parse(message)

      // Skip messages from this instance (already invalidated locally)
      if (msg.instanceId === this.instanceId) {
        this.logger.debug('⏭️  Skipping own invalidation message')
        return
      }

      const age = Date.now() - msg.timestamp
      this.logger.debug(
        `📥 Received ${msg.type} invalidation from ${msg.instanceId} (${age}ms old)`
      )

      // Process based on message type
      switch (msg.type) {
        case 'user':
          if (msg.tenantId && msg.userId) {
            await this.permissionCache.invalidateUser(msg.tenantId, msg.userId)
          }
          break

        case 'tenant':
          if (msg.tenantId) {
            await this.permissionCache.invalidateTenant(msg.tenantId)
            await this.roleCache.invalidateTenantRoles(msg.tenantId)
          }
          break

        case 'role':
          if (msg.roleId && msg.tenantId) {
            await this.roleCache.invalidateRole(msg.roleId)
            // Invalidate all user permissions in tenant (role change affects users)
            await this.permissionCache.invalidateTenant(msg.tenantId)
          }
          break

        default:
          this.logger.warn(`⚠️  Unknown invalidation type: ${msg.type}`)
      }
    } catch (error) {
      this.logger.error('❌ Failed to handle invalidation message:', error)
    }
  }

  /**
   * Get pub/sub statistics for monitoring
   */
  async getStats(): Promise<{
    subscribedChannels: number
    instanceId: string
  }> {
    try {
      const channels = await this.subscriber.pubsub('NUMSUB', this.channel)
      return {
        subscribedChannels: channels[1] as number,
        instanceId: this.instanceId,
      }
    } catch (error) {
      this.logger.error('❌ Failed to retrieve pub/sub stats:', error)
      return {
        subscribedChannels: 0,
        instanceId: this.instanceId,
      }
    }
  }
}
