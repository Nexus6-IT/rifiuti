import { Module } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { GetDashboardUseCase } from './get-dashboard.use-case'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'

/**
 * Analytics Module
 *
 * Provides analytics and dashboard metrics functionality.
 */
@Module({
  imports: [PrismaModule, LoggerModule],
  providers: [AnalyticsService, GetDashboardUseCase],
  exports: [AnalyticsService, GetDashboardUseCase],
})
export class AnalyticsModule {}
