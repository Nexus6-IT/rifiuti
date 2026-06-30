/**
 * Prometheus Metrics Service
 * T228: Phase 10 - Performance Monitoring
 *
 * Exposes metrics for:
 * - permission_check_duration_seconds (histogram)
 * - permission_cache_hit_ratio (gauge)
 * - audit_log_writes_total (counter)
 * - active_temporary_grants (gauge)
 */

import { Injectable } from '@nestjs/common'
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus'
import { Counter, Gauge, Histogram, register } from 'prom-client'

export const METRICS = {
  // Histogram for permission check duration
  PERMISSION_CHECK_DURATION: 'permission_check_duration_seconds',

  // Gauge for cache hit ratio
  PERMISSION_CACHE_HIT_RATIO: 'permission_cache_hit_ratio',

  // Counter for audit log writes
  AUDIT_LOG_WRITES: 'audit_log_writes_total',

  // Gauge for active temporary grants
  ACTIVE_TEMPORARY_GRANTS: 'active_temporary_grants',

  // Counter for ABAC evaluations
  ABAC_EVALUATIONS: 'abac_evaluations_total',

  // Histogram for ABAC evaluation duration
  ABAC_EVALUATION_DURATION: 'abac_evaluation_duration_seconds',
}

@Injectable()
export class PrometheusMetricsService {
  private permissionCheckDuration: Histogram
  private permissionCacheHitRatio: Gauge
  private auditLogWrites: Counter
  private activeTemporaryGrants: Gauge
  private abacEvaluations: Counter
  private abacEvaluationDuration: Histogram

  constructor() {
    // Initialize metrics
    this.permissionCheckDuration = new Histogram({
      name: METRICS.PERMISSION_CHECK_DURATION,
      help: 'Duration of permission checks in seconds',
      labelNames: ['resource', 'action', 'decision'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    })

    this.permissionCacheHitRatio = new Gauge({
      name: METRICS.PERMISSION_CACHE_HIT_RATIO,
      help: 'Ratio of cache hits to total cache lookups',
    })

    this.auditLogWrites = new Counter({
      name: METRICS.AUDIT_LOG_WRITES,
      help: 'Total number of audit log entries written',
      labelNames: ['decision', 'resource_type'],
    })

    this.activeTemporaryGrants = new Gauge({
      name: METRICS.ACTIVE_TEMPORARY_GRANTS,
      help: 'Number of active temporary permission grants',
    })

    this.abacEvaluations = new Counter({
      name: METRICS.ABAC_EVALUATIONS,
      help: 'Total number of ABAC policy evaluations',
      labelNames: ['resource_type', 'decision'],
    })

    this.abacEvaluationDuration = new Histogram({
      name: METRICS.ABAC_EVALUATION_DURATION,
      help: 'Duration of ABAC policy evaluations in seconds',
      labelNames: ['resource_type'],
      buckets: [0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05],
    })

    // Register all metrics
    register.registerMetric(this.permissionCheckDuration)
    register.registerMetric(this.permissionCacheHitRatio)
    register.registerMetric(this.auditLogWrites)
    register.registerMetric(this.activeTemporaryGrants)
    register.registerMetric(this.abacEvaluations)
    register.registerMetric(this.abacEvaluationDuration)
  }

  /**
   * Track permission check duration
   */
  recordPermissionCheck(
    durationSeconds: number,
    resource: string,
    action: string,
    decision: 'ALLOW' | 'DENY'
  ): void {
    this.permissionCheckDuration.labels(resource, action, decision).observe(durationSeconds)
  }

  /**
   * Update cache hit ratio
   */
  updateCacheHitRatio(ratio: number): void {
    this.permissionCacheHitRatio.set(ratio)
  }

  /**
   * Increment audit log writes counter
   */
  incrementAuditLogWrites(decision: 'ALLOW' | 'DENY', resourceType: string): void {
    this.auditLogWrites.labels(decision, resourceType).inc()
  }

  /**
   * Update active temporary grants gauge
   */
  updateActiveTemporaryGrants(count: number): void {
    this.activeTemporaryGrants.set(count)
  }

  /**
   * Track ABAC evaluation
   */
  recordAbacEvaluation(
    durationSeconds: number,
    resourceType: string,
    decision: 'ALLOW' | 'DENY' | 'NOT_APPLICABLE'
  ): void {
    this.abacEvaluations.labels(resourceType, decision).inc()
    this.abacEvaluationDuration.labels(resourceType).observe(durationSeconds)
  }

  /**
   * Get current metrics (for debugging)
   */
  async getMetrics(): Promise<string> {
    return register.metrics()
  }
}

/**
 * Providers for dependency injection
 */
export const prometheusProviders = [
  PrometheusMetricsService,
  makeHistogramProvider({
    name: METRICS.PERMISSION_CHECK_DURATION,
    help: 'Duration of permission checks in seconds',
    labelNames: ['resource', 'action', 'decision'],
  }),
  makeGaugeProvider({
    name: METRICS.PERMISSION_CACHE_HIT_RATIO,
    help: 'Ratio of cache hits to total cache lookups',
  }),
  makeCounterProvider({
    name: METRICS.AUDIT_LOG_WRITES,
    help: 'Total number of audit log entries written',
    labelNames: ['decision', 'resource_type'],
  }),
  makeGaugeProvider({
    name: METRICS.ACTIVE_TEMPORARY_GRANTS,
    help: 'Number of active temporary permission grants',
  }),
]
