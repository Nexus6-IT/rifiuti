import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { GiacenzeService } from './giacenze.service'
import { GiacenzeController } from './giacenze.controller'

/**
 * GiacenzeModule — giacenze per CER e monitoraggio deposito temporaneo dal
 * registro cronologico carico/scarico (WasteMovement).
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [GiacenzeController],
  providers: [GiacenzeService],
  exports: [GiacenzeService],
})
export class GiacenzeModule {}
