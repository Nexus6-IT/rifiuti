import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { CacheStrategyService } from '../../infrastructure/caching/cache-strategy.service'

/**
 * RateLimitMiddleware
 * T232: Rate limiting to prevent API abuse
 *
 * Purpose: Protect API from abuse and DoS attacks
 *
 * Features:
 * - Per-user rate limiting
 * - Per-IP rate limiting for anonymous requests
 * - Different limits for authenticated/unauthenticated
 * - Sliding window algorithm
 * - Redis-backed for distributed systems
 * - Configurable per-endpoint limits
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name)

  // Rate limits (requests per minute)
  private readonly LIMITS = {
    AUTHENTICATED: 100, // 100 requests/min for authenticated users
    UNAUTHENTICATED: 20, // 20 requests/min for anonymous IPs
    ADMIN: 200, // Higher limit for admin users
    SENSITIVE: 10, // Lower limit for sensitive operations (login, password reset)
  }

  private readonly WINDOW_SIZE_MS = 60000 // 1 minute sliding window
  private readonly BLOCK_DURATION_MS = 300000 // 5 minutes block after limit exceeded

  constructor(private readonly cacheService: CacheStrategyService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // Determine rate limit based on user type
      const limit = this.determineRateLimit(req)
      const identifier = this.getIdentifier(req)
      const key = `rate-limit:${identifier}`

      // Get current request count from cache
      const requestData = await this.getRequestData(key)

      // Check if user is blocked
      if (requestData.blockedUntil && Date.now() < requestData.blockedUntil) {
        const remainingTime = Math.ceil((requestData.blockedUntil - Date.now()) / 1000)
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests. Please try again in ${remainingTime} seconds.`,
            error: 'RateLimitExceeded',
            retryAfter: remainingTime,
          },
          HttpStatus.TOO_MANY_REQUESTS
        )
      }

      // Remove expired timestamps (sliding window)
      const now = Date.now()
      const timestamps = requestData.timestamps.filter(
        timestamp => now - timestamp < this.WINDOW_SIZE_MS
      )

      // Check if limit exceeded
      if (timestamps.length >= limit) {
        // Block the user for BLOCK_DURATION_MS
        const blockedUntil = now + this.BLOCK_DURATION_MS
        await this.cacheService.cacheQueryResult(
          key,
          {
            timestamps,
            blockedUntil,
          },
          this.BLOCK_DURATION_MS / 1000
        )

        // Log rate limit violation
        this.logger.warn(`Rate limit exceeded for ${identifier}`, {
          identifier,
          requestCount: timestamps.length,
          limit,
          path: req.path,
          method: req.method,
        })

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests. You have been temporarily blocked.`,
            error: 'RateLimitExceeded',
            retryAfter: this.BLOCK_DURATION_MS / 1000,
          },
          HttpStatus.TOO_MANY_REQUESTS
        )
      }

      // Add current timestamp
      timestamps.push(now)

      // Update cache
      await this.cacheService.cacheQueryResult(
        key,
        {
          timestamps,
          blockedUntil: null,
        },
        this.WINDOW_SIZE_MS / 1000
      )

      // Add rate limit headers to response
      res.setHeader('X-RateLimit-Limit', limit.toString())
      res.setHeader('X-RateLimit-Remaining', (limit - timestamps.length).toString())
      res.setHeader('X-RateLimit-Reset', (now + this.WINDOW_SIZE_MS).toString())

      next()
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }

      // If cache fails, allow request but log error
      this.logger.error('Rate limiting error - allowing request', error)
      next()
    }
  }

  /**
   * Determine rate limit based on user and endpoint
   */
  private determineRateLimit(req: Request): number {
    const user = (req as any).user

    // Check for sensitive endpoints
    if (this.isSensitiveEndpoint(req.path)) {
      return this.LIMITS.SENSITIVE
    }

    // Admin users get higher limit
    if (user?.role === 'admin' || user?.permissions?.includes('admin:all')) {
      return this.LIMITS.ADMIN
    }

    // Authenticated users get standard limit
    if (user) {
      return this.LIMITS.AUTHENTICATED
    }

    // Unauthenticated requests get lower limit
    return this.LIMITS.UNAUTHENTICATED
  }

  /**
   * Get unique identifier for rate limiting
   */
  private getIdentifier(req: Request): string {
    const user = (req as any).user

    // Use userId for authenticated requests
    if (user?.userId) {
      return `user:${user.userId}`
    }

    // Use IP address for unauthenticated requests
    const ip =
      req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress

    return `ip:${ip}`
  }

  /**
   * Check if endpoint is sensitive (requires stricter rate limiting)
   */
  private isSensitiveEndpoint(path: string): boolean {
    const sensitivePaths = [
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/register',
      '/api/v1/auth/password-reset',
      '/api/v1/auth/verify-email',
    ]

    return sensitivePaths.some(sensitivePath => path.startsWith(sensitivePath))
  }

  /**
   * Get request data from cache
   */
  private async getRequestData(key: string): Promise<{
    timestamps: number[]
    blockedUntil: number | null
  }> {
    const cached = await this.cacheService.getQueryResult<{
      timestamps: number[]
      blockedUntil: number | null
    }>(key)

    if (cached) {
      return cached
    }

    return {
      timestamps: [],
      blockedUntil: null,
    }
  }
}
