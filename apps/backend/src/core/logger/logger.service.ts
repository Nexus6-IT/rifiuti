import { Injectable, Scope } from '@nestjs/common'
import pino, { Logger as PinoLogger } from 'pino'

/**
 * Logger service wrapping Pino for structured logging
 *
 * Features:
 * - Structured JSON logging
 * - Correlation ID support
 * - Multi-level logging (debug, info, warn, error, fatal)
 * - Context-aware logging
 * - Performance-optimized
 */
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService {
  private logger: PinoLogger
  private context?: string

  constructor() {
    const isDevelopment = process.env.NODE_ENV === 'development'
    const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info')

    this.logger = pino({
      level: logLevel,
      // Pretty print in development for better readability
      transport: isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
              singleLine: false,
            },
          }
        : undefined,
      // Production formatting
      formatters: {
        level: (label: string) => {
          return { level: label }
        },
        bindings: (bindings: { pid: number; hostname: string }) => {
          return {
            pid: bindings.pid,
            hostname: bindings.hostname,
            service: 'wasteflow-backend',
          }
        },
      },
      // Timestamp in ISO format
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    })
  }

  /**
   * Set the logging context (e.g., class name or module)
   */
  setContext(context: string): void {
    this.context = context
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(correlationId: string): void {
    this.logger = this.logger.child({ correlationId })
  }

  /**
   * Add tenant context to logs
   */
  setTenantId(tenantId: string): void {
    this.logger = this.logger.child({ tenantId })
  }

  /**
   * Debug level logging
   */
  debug(message: string, meta?: Record<string, any>): void {
    this.logger.debug({ context: this.context, ...meta }, message)
  }

  /**
   * Info level logging
   */
  info(message: string, meta?: Record<string, any>): void {
    this.logger.info({ context: this.context, ...meta }, message)
  }

  /**
   * Warning level logging
   */
  warn(message: string, meta?: Record<string, any>): void {
    this.logger.warn({ context: this.context, ...meta }, message)
  }

  /**
   * Error level logging
   */
  error(message: string, error?: Error, meta?: Record<string, any>): void {
    const errorInfo = error
      ? {
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
        }
      : {}

    this.logger.error({ context: this.context, ...errorInfo, ...meta }, message)
  }

  /**
   * Fatal level logging (crashes application)
   */
  fatal(message: string, error?: Error, meta?: Record<string, any>): void {
    const errorInfo = error
      ? {
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
        }
      : {}

    this.logger.fatal({ context: this.context, ...errorInfo, ...meta }, message)
  }

  /**
   * Log with custom level
   */
  log(
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: string,
    meta?: Record<string, any>
  ): void {
    this.logger[level]({ context: this.context, ...meta }, message)
  }

  /**
   * Get raw Pino logger instance for advanced usage
   */
  getPinoLogger(): PinoLogger {
    return this.logger
  }
}
