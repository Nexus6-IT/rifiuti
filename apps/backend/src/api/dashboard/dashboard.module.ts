import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { AnalyticsModule } from '../../application/analytics/analytics.module'

/**
 * Dashboard API Module
 */
@Module({
  imports: [AnalyticsModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
