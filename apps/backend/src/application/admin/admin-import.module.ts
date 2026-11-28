/**
 * AdminImportModule: superficie admin dell'import WinWaste (I8: riconciliazione; I9/I10 la estenderanno).
 * Una superficie admin per modulo, come il resto del repository.
 */
import { Module } from '@nestjs/common'
import { RiconciliazioneImportController } from '../../api/admin/riconciliazione-import.controller'
import { AuthModule } from '../../auth/auth.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { RiconciliazioneService } from '../migrazione/riconciliazione/riconciliazione.service'

@Module({
  imports: [PrismaModule, AuthModule, LoggerModule],
  controllers: [RiconciliazioneImportController],
  providers: [RiconciliazioneService],
})
export class AdminImportModule {}
