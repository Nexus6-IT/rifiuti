import { Global, Module } from '@nestjs/common'
import { MetricsService } from './metrics.service'

/**
 * Global metrics module
 *
 * Provides Prometheus metrics throughout the application.
 * Metrics are exposed via /admin/metrics/prometheus endpoint.
 */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
