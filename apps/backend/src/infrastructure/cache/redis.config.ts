import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis, { Cluster, ClusterOptions, RedisOptions } from 'ioredis'

/**
 * Redis Connection Configuration
 * Supports both standalone and cluster modes for high availability
 * Per plan.md: Redis 7 cluster for >95% cache hit rate, <10ms P99 authorization
 */
@Injectable()
export class RedisConfig {
  private readonly isCluster: boolean
  private readonly nodes: Array<{ host: string; port: number }>
  private readonly options: RedisOptions | ClusterOptions

  constructor(private configService: ConfigService) {
    // Determine if cluster mode based on environment configuration
    this.isCluster = this.configService.get<string>('REDIS_MODE') === 'cluster'

    // Parse cluster nodes from comma-separated list: host1:port1,host2:port2
    const nodesStr = this.configService.get<string>('REDIS_CLUSTER_NODES', 'localhost:6379')
    this.nodes = nodesStr.split(',').map(node => {
      const [host, port] = node.split(':')
      return { host, port: parseInt(port, 10) }
    })

    // Common options for both standalone and cluster
    const commonOptions = {
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
      retryStrategy: (times: number) => {
        // Exponential backoff: 50ms, 100ms, 200ms, ... max 3000ms
        const delay = Math.min(times * 50, 3000)
        return delay
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      // Connection pool settings for high concurrency (10,000 req/s target)
      enableOfflineQueue: true,
      connectTimeout: 10000,
      // Keep-alive to prevent connection drops
      keepAlive: 30000,
    }

    if (this.isCluster) {
      // Cluster-specific options
      this.options = {
        ...commonOptions,
        redisOptions: {
          password: commonOptions.password,
          connectTimeout: commonOptions.connectTimeout,
        },
        clusterRetryStrategy: (times: number) => {
          return Math.min(times * 100, 3000)
        },
        enableReadyCheck: true,
        // Scale read operations across replicas
        scaleReads: 'slave',
        maxRedirections: 16,
      } as ClusterOptions
    } else {
      // Standalone options
      this.options = {
        ...commonOptions,
        host: this.nodes[0].host,
        port: this.nodes[0].port,
      } as RedisOptions
    }
  }

  /**
   * Create Redis client instance
   * Returns either standalone Redis or Cluster based on configuration
   */
  createClient(): Redis | Cluster {
    if (this.isCluster) {
      return new Redis.Cluster(this.nodes, this.options as ClusterOptions)
    } else {
      return new Redis(this.options as RedisOptions)
    }
  }

  /**
   * Create Redis client for pub/sub operations
   * Separate connection recommended for pub/sub to avoid blocking
   */
  createPubSubClient(): Redis | Cluster {
    return this.createClient()
  }

  /**
   * Get Redis configuration info for logging/monitoring
   */
  getConnectionInfo(): {
    mode: string
    nodes: Array<{ host: string; port: number }>
    database: number
  } {
    return {
      mode: this.isCluster ? 'cluster' : 'standalone',
      nodes: this.nodes,
      database: this.configService.get<number>('REDIS_DB', 0),
    }
  }
}
