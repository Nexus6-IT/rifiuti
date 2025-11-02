import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Correlation ID Middleware
 *
 * Generates or extracts correlation IDs for request tracing.
 * Correlation IDs enable tracking requests across services and logs.
 *
 * Header priority:
 * 1. X-Correlation-ID (if provided by client)
 * 2. X-Request-ID (fallback)
 * 3. Generated UUID v4
 *
 * The correlation ID is:
 * - Attached to request object as `req.correlationId`
 * - Added to response headers
 * - Included in all logs for this request
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Extract or generate correlation ID
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      uuidv4();

    // Attach to request object
    (req as any).correlationId = correlationId;

    // Add to response headers
    res.setHeader('X-Correlation-ID', correlationId);

    next();
  }
}

/**
 * Decorator to extract correlation ID from request
 *
 * Usage in controllers:
 * ```typescript
 * @Get()
 * async getFIRs(@CorrelationId() correlationId: string) {
 *   // correlationId is automatically extracted
 * }
 * ```
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CorrelationId = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.correlationId || 'unknown';
});
