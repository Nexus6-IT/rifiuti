import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { EsgService } from './esg.service'
import { EsgController } from './esg.controller'

/**
 * EsgModule — reporting ESG (CO₂ evitata, % recupero) derivato dai FIR.
 * Pronto da importare in AppModule per esporre `GET /api/v1/esg/report`.
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [EsgController],
  providers: [EsgService],
  exports: [EsgService],
})
export class EsgModule {}
