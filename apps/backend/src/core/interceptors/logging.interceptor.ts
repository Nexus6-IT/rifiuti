import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { Request, Response } from 'express'
import { LoggerService } from '../logger/logger.service'
import { MetricsService } from '../metrics/metrics.service'

/**
 * Logging Interceptor
 *
 * Logs all HTTP requests and responses with:
 * - Request method, URL, and correlation ID
 * - Response status code and duration
 * - Tenant and user context
 * - Metrics recording (response time, request count)
 *
 * Example log output:
 * ```
 * GET /api/v1/fir - 200 OK - 45ms
 * {
 *   correlationId: "uuid",
 *   tenantId: "uuid",
 *   userId: "uuid",
 *   method: "GET",
 *   url: "/api/v1/fir",
 *   statusCode: 200,
 *   duration: 45
 * }
 * ```
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext('HTTP')
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<Request>()
    const response = ctx.getResponse<Response>()

    const { method, url } = request
    const correlationId = (request as any).correlationId || 'unknown'
    const tenantId = (request as any).tenantId
    const userId = (request as any).user?.userId
    const startTime = Date.now()

    // Log incoming request
    this.logger.debug(`Incoming ${method} ${url}`, {
      correlationId,
      tenantId,
      userId,
      method,
      url,
    })

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime
          const statusCode = response.statusCode

          // Log successful response
          this.logger.info(`${method} ${url} - ${statusCode} - ${duration}ms`, {
            correlationId,
            tenantId,
            userId,
            method,
            url,
            statusCode,
            duration,
          })

          // Record metrics
          this.recordMetrics(method, url, statusCode, duration)
        },
        error: error => {
          const duration = Date.now() - startTime
          const statusCode = error.status || 500

          // Log error response
          this.logger.error(`${method} ${url} - ${statusCode} - ${duration}ms`, error, {
            correlationId,
            tenantId,
            userId,
            method,
            url,
            statusCode,
            duration,
            errorMessage: error.message,
          })

          // Record error metrics
          this.recordMetrics(method, url, statusCode, duration)
          this.metrics.httpRequestErrors.inc({
            method,
            route: this.normalizeRoute(url),
            error_code: error.code || 'UNKNOWN',
          })
        },
      })
    )
  }

  /**
   * Record HTTP metrics to Prometheus
   */
  private recordMetrics(method: string, url: string, statusCode: number, duration: number): void {
    const route = this.normalizeRoute(url)

    // Record request count
    this.metrics.httpRequestTotal.inc({
      method,
      route,
      status_code: statusCode.toString(),
    })

    // Record response time
    this.metrics.httpRequestDuration.observe(
      {
        method,
        route,
        status_code: statusCode.toString(),
      },
      duration / 1000 // Convert to seconds
    )
  }

  /**
   * Normalize URL to route pattern for metrics
   * Example: /api/v1/fir/123 -> /api/v1/fir/:id
   */
  private normalizeRoute(url: string): string {
    // Remove query string
    const path = url.split('?')[0]

    // Replace UUIDs with :id
    return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  }
}
