import { Module } from '@nestjs/common';
import { HealthCheckController } from './health-check.controller';
import { PrismaModule } from '../database/prisma.module';

/**
 * Monitoring Module
 *
 * Provides health check and monitoring endpoints.
 */
@Module({
  imports: [PrismaModule],
  controllers: [HealthCheckController],
})
export class MonitoringModule {}
