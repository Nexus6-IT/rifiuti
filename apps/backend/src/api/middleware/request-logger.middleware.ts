import { Injectable, NestMiddleware, Logger } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'

/**
 * RequestLoggerMiddleware
 * T230: HTTP request/response logging middleware
 *
 * Purpose: Log all HTTP requests with timing and context
 *
 * Features:
 * - Request/response timing
 * - User and tenant tracking
 * - Slow request detection
 * - Error rate monitoring
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggerMiddleware.name)
  private readonly SLOW_REQUEST_THRESHOLD_MS = 1000 // 1 second

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now()

    // Generate correlation ID if not present
    const correlationId = req.headers['x-correlation-id'] || this.generateCorrelationId()
    req.headers['x-correlation-id'] = correlationId as string

    // Log request start
    this.logRequestStart(req, correlationId as string)

    // Capture response finish event
    res.on('finish', () => {
      const duration = Date.now() - startTime
      this.logRequestComplete(req, res, duration, correlationId as string)
    })

    next()
  }

  /**
   * Log request start
   */
  private logRequestStart(req: Request, correlationId: string): void {
    const user = (req as any).user

    this.logger.log({
      type: 'request_start',
      correlationId,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      userId: user?.userId || 'anonymous',
      tenantId: user?.tenantId || 'none',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    })
  }

  /**
   * Log request completion
   */
  private logRequestComplete(
    req: Request,
    res: Response,
    duration: number,
    correlationId: string
  ): void {
    const user = (req as any).user

    const logData = {
      type: 'request_complete',
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: user?.userId || 'anonymous',
      tenantId: user?.tenantId || 'none',
      contentLength: res.get('content-length'),
    }

    // Determine log level based on status code and duration
    if (res.statusCode >= 500) {
      this.logger.error('Server error response', logData)
    } else if (res.statusCode >= 400) {
      this.logger.warn('Client error response', logData)
    } else if (duration > this.SLOW_REQUEST_THRESHOLD_MS) {
      this.logger.warn(`Slow request (${duration}ms)`, logData)
    } else {
      this.logger.log('Request completed successfully', logData)
    }

    // Add correlation ID to response headers for client tracking
    res.setHeader('X-Correlation-ID', correlationId)
  }

  /**
   * Generate unique correlation ID
   */
  private generateCorrelationId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(7)}`
  }
}
