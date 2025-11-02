/**
 * Redis Service
 * Manages sessions, refresh tokens, and token revocation
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
    })

    this.client.on('error', (err: Error) => {
      console.error('Redis Client Error:', err)
    })

    this.client.on('connect', () => {
      console.log('✅ Redis connected')
    })
  }

  /**
   * Store refresh token with expiration
   */
  async storeRefreshToken(userId: string, token: string, ttlSeconds: number): Promise<void> {
    const key = `refresh_token:${userId}:${token}`
    await this.client.set(key, '1', 'EX', ttlSeconds)
  }

  /**
   * Check if refresh token is valid
   */
  async isRefreshTokenValid(userId: string, token: string): Promise<boolean> {
    const key = `refresh_token:${userId}:${token}`
    const exists = await this.client.exists(key)
    return exists === 1
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(userId: string, token: string): Promise<void> {
    const key = `refresh_token:${userId}:${token}`
    await this.client.del(key)
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `refresh_token:${userId}:*`
    const keys = await this.client.keys(pattern)

    if (keys.length > 0) {
      await this.client.del(...keys)
    }
  }

  /**
   * Store access token in revocation list (for logout)
   */
  async revokeAccessToken(token: string, ttlSeconds: number): Promise<void> {
    const key = `revoked_access_token:${token}`
    await this.client.set(key, '1', 'EX', ttlSeconds)
  }

  /**
   * Check if access token is revoked
   */
  async isAccessTokenRevoked(token: string): Promise<boolean> {
    const key = `revoked_access_token:${token}`
    const exists = await this.client.exists(key)
    return exists === 1
  }

  /**
   * Store session data
   */
  async setSession(sessionId: string, data: any, ttlSeconds: number): Promise<void> {
    const key = `session:${sessionId}`
    await this.client.set(key, JSON.stringify(data), 'EX', ttlSeconds)
  }

  /**
   * Get session data
   */
  async getSession(sessionId: string): Promise<any | null> {
    const key = `session:${sessionId}`
    const data = await this.client.get(key)
    return data ? JSON.parse(data) : null
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`
    await this.client.del(key)
  }

  /**
   * Store generic value with TTL
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.client.set(key, value)
    }
  }

  /**
   * Get generic value
   */
  async get(key: string): Promise<string | null> {
    return await this.client.get(key)
  }

  /**
   * Delete generic value
   */
  async delete(key: string): Promise<void> {
    await this.client.del(key)
  }

  /**
   * Check connection health
   */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping()
      return pong === 'PONG'
    } catch {
      return false
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    await this.client.quit()
  }
}
