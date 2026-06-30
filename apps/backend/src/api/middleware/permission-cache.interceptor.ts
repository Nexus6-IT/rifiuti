import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { CacheStrategyService } from '../../infrastructure/caching/cache-strategy.service'

/**
 * PermissionCacheInterceptor
 * T224: Hot path optimization for permission checking
 *
 * Purpose: Cache permission check results to reduce database load
 *
 * Performance targets:
 * - <5ms for cached permission checks
 * - <10ms for cache miss with database lookup
 * - 90%+ cache hit rate for permission checks
 */
@Injectable()
export class PermissionCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PermissionCacheInterceptor.name)

  constructor(private readonly cacheService: CacheStrategyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const startTime = Date.now()

    // Extract user and tenant from request
    const userId = request.user?.userId
    const tenantId = request.user?.tenantId

    if (!userId || !tenantId) {
      // No caching for unauthenticated requests
      return next.handle()
    }

    // Check if this is a permission-guarded endpoint
    const handler = context.getHandler()
    const controller = context.getClass()
    const requiredPermissions = this.extractRequiredPermissions(handler, controller)

    if (!requiredPermissions || requiredPermissions.length === 0) {
      // No permission requirements - skip caching
      return next.handle()
    }

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime

        // Log permission check performance
        if (duration > 10) {
          this.logger.warn(
            `Slow permission check: ${duration}ms for user ${userId} on ${request.path}`
          )
        }

        // Cache the successful permission check result
        // This allows subsequent requests to skip the full check
        const cacheKey = this.buildCacheKey(userId, tenantId, request.path)
        this.cacheService.cacheQueryResult(cacheKey, true, 300) // 5 min TTL
      })
    )
  }

  /**
   * Extract required permissions from handler metadata
   */
  private extractRequiredPermissions(_handler: any, _controller: any): string[] | null {
    // This would use Reflector to extract @RequirePermission metadata
    // For now, returning null as placeholder
    return null
  }

  /**
   * Build cache key for permission check result
   */
  private buildCacheKey(userId: string, tenantId: string, path: string): string {
    return `perm-check:${tenantId}:${userId}:${path}`
  }
}
