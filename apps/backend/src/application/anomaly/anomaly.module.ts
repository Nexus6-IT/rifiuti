import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { AnomalyDetectionService } from './anomaly-detection.service'
import { AnomalyController } from './anomaly.controller'

/**
 * AnomalyModule — rilevamento anomalie (a regole) su FIR e movimenti.
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [AnomalyController],
  providers: [AnomalyDetectionService],
  exports: [AnomalyDetectionService],
})
export class AnomalyModule {}
