import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError, PrismaClientValidationError } from'@prisma/client/runtime/library';
import { ErrorAggregationService } from '../../infrastructure/monitoring/error-aggregation.service';

/**
 * GlobalExceptionFilter
 * T228: Centralized error handling with structured logging
 * T231: Integrated with error aggregation and alerting
 *
 * Purpose: Catch and transform all exceptions into consistent API responses
 *
 * Features:
 * - Structured error logging
 * - User-friendly error messages
 * - Security: Don't leak internal details
 * - Correlation IDs for error tracking
 * - Database error translation
 * - Error aggregation and pattern detection
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly errorAggregation?: ErrorAggregationService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Generate correlation ID for tracking
    const correlationId = this.generateCorrelationId();

    // Determine status code and error details
    const errorResponse = this.buildErrorResponse(exception, request, correlationId);

    // Log error with context
    this.logError(exception, request, correlationId, errorResponse);

    // Send response
    response.status(errorResponse.statusCode).json({
      success: false,
      error: {
        statusCode: errorResponse.statusCode,
        message: errorResponse.message,
        error: errorResponse.error,
        timestamp: new Date().toISOString(),
        path: request.url,
        correlationId,
        ...(errorResponse.details && { details: errorResponse.details }),
      },
    });
  }

  /**
   * Build structured error response
   */
  private buildErrorResponse(
    exception: unknown,
    request: Request,
    correlationId: string,
  ): {
    statusCode: number;
    message: string;
    error: string;
    details?: any;
  } {
    // Handle HTTP exceptions (NestJS built-in)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      return {
        statusCode: status,
        message: this.extractMessage(exceptionResponse),
        error: exception.name,
        details: typeof exceptionResponse === 'object' ? exceptionResponse : undefined,
      };
    }

    // Handle Prisma errors (database)
    if (this.isPrismaError(exception)) {
      return this.handlePrismaError(exception as any);
    }

    // Handle validation errors
    if (this.isValidationError(exception)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        error: 'ValidationError',
        details: (exception as any).errors,
      };
    }

    // Handle unknown errors (don't leak internal details)
    this.logger.error(
      `Unhandled exception: ${exception}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
      error: 'InternalServerError',
    };
  }

  /**
   * Handle Prisma database errors
   */
  private handlePrismaError(error: PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
    error: string;
    details?: any;
  } {
    switch (error.code) {
      case 'P2002': // Unique constraint violation
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `A record with this ${this.extractFieldName(error)} already exists`,
          error: 'UniqueConstraintViolation',
          details: { fields: error.meta?.target },
        };

      case 'P2025': // Record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'The requested resource was not found',
          error: 'ResourceNotFound',
        };

      case 'P2003': // Foreign key constraint violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Cannot perform this operation due to related records',
          error: 'ForeignKeyConstraintViolation',
        };

      case 'P2014': // Relation violation
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid relation in request',
          error: 'RelationViolation',
        };

      default:
        this.logger.error(`Unhandled Prisma error code: ${error.code}`, error.message);
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred',
          error: 'DatabaseError',
        };
    }
  }

  /**
   * Log error with structured context
   */
  private logError(
    exception: unknown,
    request: Request,
    correlationId: string,
    errorResponse: any,
  ): void {
    const logContext = {
      correlationId,
      path: request.url,
      method: request.method,
      statusCode: errorResponse.statusCode,
      user: (request as any).user?.userId || 'anonymous',
      tenant: (request as any).user?.tenantId || 'none',
      error: errorResponse.error,
      message: errorResponse.message,
    };

    // Record error for aggregation and alerting (T231)
    if (this.errorAggregation) {
      this.errorAggregation.recordError({
        type: errorResponse.error,
        message: errorResponse.message,
        statusCode: errorResponse.statusCode,
        path: request.url,
        userId: (request as any).user?.userId,
        tenantId: (request as any).user?.tenantId,
        correlationId,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }

    // Log at appropriate level
    if (errorResponse.statusCode >= 500) {
      // Server errors - critical
      this.logger.error(
        `Server error: ${errorResponse.message}`,
        exception instanceof Error ? exception.stack : undefined,
        logContext,
      );
    } else if (errorResponse.statusCode >= 400) {
      // Client errors - warning
      this.logger.warn(`Client error: ${errorResponse.message}`, logContext);
    } else {
      // Other - debug
      this.logger.debug(`Request exception: ${errorResponse.message}`, logContext);
    }
  }

  // Helper methods
  private generateCorrelationId(): string {
    return `err-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  private extractMessage(response: string | object): string {
    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && 'message' in response) {
      const message = (response as any).message;
      return Array.isArray(message) ? message.join(', ') : message;
    }

    return 'An error occurred';
  }

  private extractFieldName(error: PrismaClientKnownRequestError): string {
    const target = error.meta?.target as string[];
    return target ? target.join(', ') : 'field';
  }

  private isPrismaError(exception: unknown): boolean {
    return (
      exception instanceof PrismaClientKnownRequestError ||
      exception instanceof PrismaClientValidationError
    );
  }

  private isValidationError(exception: unknown): boolean {
    return (
      exception instanceof Error &&
      (exception.name === 'ValidationError' || 'errors' in exception)
    );
  }
}
