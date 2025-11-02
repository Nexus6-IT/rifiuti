import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';

/**
 * StructuredLoggerService
 * T229: Production-ready structured logging
 *
 * Purpose: Centralized logging with structured data for observability
 *
 * Features:
 * - JSON structured logs for easy parsing
 * - Log levels with filtering
 * - Context enrichment (tenant, user, correlation ID)
 * - Performance metrics logging
 * - Integration-ready for ELK/CloudWatch/Datadog
 */
@Injectable()
export class StructuredLoggerService implements LoggerService {
  private logger: winston.Logger;
  private context: string = 'Application';

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'wasteflow-backend',
        environment: process.env.NODE_ENV || 'development',
      },
      transports: [
        // Console output
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
        }),
        // File output for errors
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
        }),
        // File output for all logs
        new winston.transports.File({
          filename: 'logs/combined.log',
        }),
      ],
    });
  }

  /**
   * Set logging context (e.g., controller name, service name)
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * Log with structured data
   */
  log(message: string, context?: any): void {
    this.logger.info(message, {
      context: this.context,
      ...this.enrichContext(context),
    });
  }

  /**
   * Error logging with stack trace
   */
  error(message: string, trace?: string, context?: any): void {
    this.logger.error(message, {
      context: this.context,
      stack: trace,
      ...this.enrichContext(context),
    });
  }

  /**
   * Warning logs
   */
  warn(message: string, context?: any): void {
    this.logger.warn(message, {
      context: this.context,
      ...this.enrichContext(context),
    });
  }

  /**
   * Debug logs (verbose)
   */
  debug(message: string, context?: any): void {
    this.logger.debug(message, {
      context: this.context,
      ...this.enrichContext(context),
    });
  }

  /**
   * Verbose logs (very detailed)
   */
  verbose(message: string, context?: any): void {
    this.logger.verbose(message, {
      context: this.context,
      ...this.enrichContext(context),
    });
  }

  /**
   * Log HTTP request/response
   */
  logRequest(req: any, res: any, duration: number): void {
    const logData = {
      type: 'http_request',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.userId || 'anonymous',
      tenantId: req.user?.tenantId || 'none',
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (res.statusCode >= 400) {
      this.logger.warn('HTTP request failed', logData);
    } else {
      this.logger.info('HTTP request completed', logData);
    }
  }

  /**
   * Log database query performance
   */
  logQuery(query: string, duration: number, recordCount?: number): void {
    const logData = {
      type: 'database_query',
      duration: `${duration}ms`,
      recordCount: recordCount || 0,
      query: query.substring(0, 200), // Truncate long queries
    };

    if (duration > 100) {
      this.logger.warn('Slow database query detected', logData);
    } else {
      this.logger.debug('Database query executed', logData);
    }
  }

  /**
   * Log cache hit/miss
   */
  logCache(key: string, hit: boolean, duration?: number): void {
    this.logger.debug(`Cache ${hit ? 'HIT' : 'MISS'}`, {
      type: 'cache_operation',
      key,
      hit,
      duration: duration ? `${duration}ms` : undefined,
    });
  }

  /**
   * Log business event
   */
  logEvent(eventType: string, data: any): void {
    this.logger.info(`Business event: ${eventType}`, {
      type: 'business_event',
      eventType,
      ...data,
    });
  }

  /**
   * Log security event
   */
  logSecurityEvent(eventType: string, data: any): void {
    this.logger.warn(`Security event: ${eventType}`, {
      type: 'security_event',
      eventType,
      ...data,
    });
  }

  /**
   * Log performance metric
   */
  logMetric(name: string, value: number, unit: string): void {
    this.logger.info(`Metric: ${name}`, {
      type: 'metric',
      name,
      value,
      unit,
    });
  }

  /**
   * Enrich log context with request data
   */
  private enrichContext(context: any): any {
    if (!context) return {};

    return {
      correlationId: context.correlationId,
      userId: context.userId,
      tenantId: context.tenantId,
      ...context,
    };
  }
}
