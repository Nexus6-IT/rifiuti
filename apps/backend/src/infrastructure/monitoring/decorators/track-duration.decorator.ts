/**
 * Custom Metrics Decorators
 * T229: Phase 10 - Performance Monitoring
 *
 * @TrackDuration - Auto-track method execution time
 * @IncrementCounter - Auto-increment counter
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('MetricsDecorator');

/**
 * Track method duration and expose as Prometheus histogram
 * Usage: @TrackDuration('my_operation_duration_seconds')
 */
export function TrackDuration(metricName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = performance.now();

      try {
        const result = await originalMethod.apply(this, args);
        const durationMs = performance.now() - startTime;
        const durationSeconds = durationMs / 1000;

        // Log duration
        logger.debug(
          `${metricName}: ${propertyKey} completed in ${durationMs.toFixed(2)}ms`,
        );

        // TODO: Record to Prometheus histogram (requires access to metrics service)
        // This.metricsService?.recordDuration(metricName, durationSeconds);

        return result;
      } catch (error) {
        const durationMs = performance.now() - startTime;
        logger.error(
          `${metricName}: ${propertyKey} failed after ${durationMs.toFixed(2)}ms`,
          error,
        );
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Increment counter on method execution
 * Usage: @IncrementCounter('my_operation_total')
 */
export function IncrementCounter(metricName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        const result = await originalMethod.apply(this, args);

        // Log increment
        logger.debug(`${metricName}: ${propertyKey} executed successfully`);

        // TODO: Increment Prometheus counter
        // this.metricsService?.incrementCounter(metricName);

        return result;
      } catch (error) {
        logger.error(`${metricName}: ${propertyKey} failed`, error);
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Track performance with labels
 * Usage: @TrackPerformance({ metric: 'operation_duration', labels: { type: 'database' } })
 */
export function TrackPerformance(options: {
  metric: string;
  labels?: Record<string, string>;
}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = performance.now();

      try {
        const result = await originalMethod.apply(this, args);
        const durationMs = performance.now() - startTime;

        const labelStr = options.labels
          ? Object.entries(options.labels)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')
          : '';

        logger.debug(
          `${options.metric}: ${propertyKey} [${labelStr}] completed in ${durationMs.toFixed(2)}ms`,
        );

        return result;
      } catch (error) {
        throw error;
      }
    };

    return descriptor;
  };
}
