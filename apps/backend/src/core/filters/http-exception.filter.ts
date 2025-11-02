import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger/logger.service';
import { DomainException } from '../../domain/shared/domain-exception';

/**
 * Global HTTP Exception Filter
 *
 * Catches all exceptions and formats them into consistent error responses.
 * Handles:
 * - HTTP exceptions from NestJS
 * - Domain exceptions from business logic
 * - Unexpected errors
 *
 * Response format:
 * ```json
 * {
 *   "statusCode": 400,
 *   "error": "BAD_REQUEST",
 *   "message": "Validation failed",
 *   "correlationId": "uuid",
 *   "timestamp": "2025-01-18T10:30:00Z",
 *   "path": "/api/v1/fir"
 * }
 * ```
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('HttpExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId = (request as any).correlationId || 'unknown';
    const tenantId = (request as any).tenantId;
    const userId = (request as any).user?.userId;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: any = undefined;

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const response = exceptionResponse as any;
        message = response.message || exception.message;
        errorCode = response.error || this.getErrorCodeFromStatus(statusCode);
        details = response.details;
      }
    }
    // Handle Domain exceptions
    else if (exception instanceof DomainException) {
      statusCode = HttpStatus.BAD_REQUEST;
      errorCode = exception.code || 'DOMAIN_ERROR';
      message = exception.message;
      details = exception.metadata;
    }
    // Handle unexpected errors
    else if (exception instanceof Error) {
      message = exception.message;
      errorCode = 'INTERNAL_SERVER_ERROR';
    }

    // Log the error
    this.logger.error(
      `HTTP ${request.method} ${request.url} - ${statusCode} ${errorCode}`,
      exception instanceof Error ? exception : undefined,
      {
        correlationId,
        tenantId,
        userId,
        statusCode,
        errorCode,
        path: request.url,
        method: request.method,
      },
    );

    // Send error response
    const errorResponse = {
      statusCode,
      error: errorCode,
      message,
      ...(details && { details }),
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(errorResponse);
  }

  /**
   * Map HTTP status code to error code
   */
  private getErrorCodeFromStatus(statusCode: number): string {
    const statusMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT',
    };

    return statusMap[statusCode] || 'UNKNOWN_ERROR';
  }
}
