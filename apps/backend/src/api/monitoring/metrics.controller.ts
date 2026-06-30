/**
 * Metrics Controller
 * T228: Phase 10 - Prometheus Metrics Endpoint
 *
 * Exposes /metrics endpoint for Prometheus scraping
 */

import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger'
import { PrometheusMetricsService } from '../../infrastructure/monitoring/prometheus-metrics.service'

@ApiTags('Monitoring')
@Controller()
export class MetricsController {
  constructor(private readonly metricsService: PrometheusMetricsService) {}

  /**
   * Prometheus metrics endpoint
   * Scraped by Prometheus server
   */
  @Get('metrics')
  @ApiExcludeEndpoint() // Don't show in Swagger
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics()
  }
}
