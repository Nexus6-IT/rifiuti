import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { AttenzioneController } from './attenzione.controller'
import { AnalyticsModule } from '../../application/analytics/analytics.module'
import { RaccogliAttenzioneUseCase } from '../../application/dashboard/raccogli-attenzione.use-case'
import { PrismaModule } from '../../infrastructure/database/prisma.module'

/**
 * Dashboard API Module
 */
@Module({
  imports: [AnalyticsModule, PrismaModule],
  controllers: [DashboardController, AttenzioneController],
  providers: [RaccogliAttenzioneUseCase],
})
export class DashboardModule {}
