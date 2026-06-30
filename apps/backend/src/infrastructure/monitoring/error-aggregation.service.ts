import { Injectable, Logger } from '@nestjs/common'
import { StructuredLoggerService } from '../logging/structured-logger.service'

/**
 * ErrorAggregationService
 * T231: Error monitoring, pattern detection, and alerting
 *
 * Purpose: Aggregate errors, detect patterns, and trigger alerts
 *
 * Features:
 * - Error rate monitoring with time windows
 * - Pattern detection (repeated errors, cascading failures)
 * - Alert thresholds (critical/warning levels)
 * - Error deduplication
 * - Integration-ready for PagerDuty/Slack/email
 */
@Injectable()
export class ErrorAggregationService {
  private readonly logger = new Logger(ErrorAggregationService.name)
  private errorCounts: Map<string, ErrorMetrics> = new Map()
  private readonly WINDOW_SIZE_MS = 60000 // 1 minute
  private readonly CLEANUP_INTERVAL_MS = 300000 // 5 minutes

  // Alert thresholds
  private readonly THRESHOLDS = {
    CRITICAL_ERROR_RATE: 10, // Errors per minute
    WARNING_ERROR_RATE: 5,
    CRITICAL_500_RATE: 5, // Server errors per minute
    REPEATED_ERROR_COUNT: 3, // Same error 3 times = pattern
  }

  constructor(private readonly structuredLogger: StructuredLoggerService) {
    // Start cleanup job to prevent memory leaks
    setInterval(() => this.cleanupOldMetrics(), this.CLEANUP_INTERVAL_MS)
  }

  /**
   * Record error occurrence for monitoring
   */
  recordError(error: ErrorRecord): void {
    const key = this.generateErrorKey(error)
    const now = Date.now()

    // Get or create metrics for this error type
    let metrics = this.errorCounts.get(key)
    if (!metrics) {
      metrics = {
        errorType: error.type,
        errorMessage: error.message,
        count: 0,
        firstSeen: now,
        lastSeen: now,
        occurrences: [],
        statusCode: error.statusCode,
      }
      this.errorCounts.set(key, metrics)
    }

    // Update metrics
    metrics.count++
    metrics.lastSeen = now
    metrics.occurrences.push(now)

    // Remove old occurrences outside time window
    metrics.occurrences = metrics.occurrences.filter(
      timestamp => now - timestamp < this.WINDOW_SIZE_MS
    )

    // Check if alert threshold exceeded
    this.checkAlertThresholds(key, metrics, error)

    // Log the error with context
    this.structuredLogger.error('Error recorded', undefined, {
      errorType: error.type,
      statusCode: error.statusCode,
      path: error.path,
      userId: error.userId,
      tenantId: error.tenantId,
      correlationId: error.correlationId,
    })
  }

  /**
   * Check if error metrics exceed alert thresholds
   */
  private checkAlertThresholds(key: string, metrics: ErrorMetrics, error: ErrorRecord): void {
    const errorRate = metrics.occurrences.length

    // Critical: High rate of server errors (5xx)
    if (metrics.statusCode >= 500 && errorRate >= this.THRESHOLDS.CRITICAL_500_RATE) {
      this.sendAlert('critical', {
        title: 'High Server Error Rate',
        message: `${errorRate} server errors in the last minute`,
        errorType: metrics.errorType,
        statusCode: metrics.statusCode,
        path: error.path,
      })
    }

    // Critical: Overall error rate too high
    if (errorRate >= this.THRESHOLDS.CRITICAL_ERROR_RATE) {
      this.sendAlert('critical', {
        title: 'High Error Rate Detected',
        message: `${errorRate} errors in the last minute`,
        errorType: metrics.errorType,
      })
    }

    // Warning: Elevated error rate
    if (errorRate >= this.THRESHOLDS.WARNING_ERROR_RATE) {
      this.sendAlert('warning', {
        title: 'Elevated Error Rate',
        message: `${errorRate} errors in the last minute`,
        errorType: metrics.errorType,
      })
    }

    // Pattern detection: Repeated identical errors
    if (metrics.count >= this.THRESHOLDS.REPEATED_ERROR_COUNT) {
      const timeSinceFirst = metrics.lastSeen - metrics.firstSeen
      if (timeSinceFirst < this.WINDOW_SIZE_MS) {
        this.sendAlert('warning', {
          title: 'Error Pattern Detected',
          message: `Same error occurred ${metrics.count} times`,
          errorType: metrics.errorType,
          errorMessage: metrics.errorMessage,
        })
      }
    }
  }

  /**
   * Send alert to configured channels
   */
  private sendAlert(severity: 'critical' | 'warning', alert: AlertPayload): void {
    // Log the alert
    if (severity === 'critical') {
      this.logger.error(`ALERT [${severity.toUpperCase()}]: ${alert.title}`, {
        ...alert,
        timestamp: new Date().toISOString(),
      })
    } else {
      this.logger.warn(`ALERT [${severity.toUpperCase()}]: ${alert.title}`, {
        ...alert,
        timestamp: new Date().toISOString(),
      })
    }

    // In production, integrate with:
    // - PagerDuty for critical alerts
    // - Slack for warning alerts
    // - Email for daily digests
    // - CloudWatch/Datadog for metrics

    // Example integration point:
    // if (severity === 'critical') {
    //   this.pagerDutyService.triggerIncident(alert);
    // }
    // this.slackService.sendAlert(severity, alert);
  }

  /**
   * Get current error metrics
   */
  getErrorMetrics(): ErrorMetricsSummary {
    const now = Date.now()
    const recentErrors: ErrorMetrics[] = []
    let totalErrorsLastMinute = 0
    let serverErrorsLastMinute = 0

    for (const [_key, metrics] of this.errorCounts.entries()) {
      // Only include errors from last minute
      const recentCount = metrics.occurrences.filter(
        timestamp => now - timestamp < this.WINDOW_SIZE_MS
      ).length

      if (recentCount > 0) {
        totalErrorsLastMinute += recentCount
        if (metrics.statusCode >= 500) {
          serverErrorsLastMinute += recentCount
        }
        recentErrors.push(metrics)
      }
    }

    return {
      totalErrorsLastMinute,
      serverErrorsLastMinute,
      clientErrorsLastMinute: totalErrorsLastMinute - serverErrorsLastMinute,
      uniqueErrorTypes: recentErrors.length,
      topErrors: recentErrors
        .sort((a, b) => b.occurrences.length - a.occurrences.length)
        .slice(0, 5),
    }
  }

  /**
   * Get health status based on error rates
   */
  getHealthStatus(): HealthStatus {
    const metrics = this.getErrorMetrics()

    if (metrics.serverErrorsLastMinute >= this.THRESHOLDS.CRITICAL_500_RATE) {
      return {
        status: 'critical',
        message: 'High rate of server errors',
        errorRate: metrics.totalErrorsLastMinute,
      }
    }

    if (metrics.totalErrorsLastMinute >= this.THRESHOLDS.CRITICAL_ERROR_RATE) {
      return {
        status: 'degraded',
        message: 'Elevated error rate',
        errorRate: metrics.totalErrorsLastMinute,
      }
    }

    return {
      status: 'healthy',
      message: 'System operating normally',
      errorRate: metrics.totalErrorsLastMinute,
    }
  }

  /**
   * Generate unique key for error deduplication
   */
  private generateErrorKey(error: ErrorRecord): string {
    // Group errors by type, status code, and path
    return `${error.type}-${error.statusCode}-${error.path || 'unknown'}`
  }

  /**
   * Clean up old metrics to prevent memory leaks
   */
  private cleanupOldMetrics(): void {
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, metrics] of this.errorCounts.entries()) {
      // Delete metrics if last occurrence was more than 5 minutes ago
      if (now - metrics.lastSeen > this.CLEANUP_INTERVAL_MS) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => this.errorCounts.delete(key))

    if (keysToDelete.length > 0) {
      this.logger.debug(`Cleaned up ${keysToDelete.length} old error metrics`)
    }
  }
}

// Types
interface ErrorRecord {
  type: string
  message: string
  statusCode: number
  path?: string
  userId?: string
  tenantId?: string
  correlationId?: string
  stack?: string
}

interface ErrorMetrics {
  errorType: string
  errorMessage: string
  count: number
  firstSeen: number
  lastSeen: number
  occurrences: number[] // Timestamps
  statusCode: number
}

interface AlertPayload {
  title: string
  message: string
  errorType: string
  errorMessage?: string
  statusCode?: number
  path?: string
}

interface ErrorMetricsSummary {
  totalErrorsLastMinute: number
  serverErrorsLastMinute: number
  clientErrorsLastMinute: number
  uniqueErrorTypes: number
  topErrors: ErrorMetrics[]
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'critical'
  message: string
  errorRate: number
}
