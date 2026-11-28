/**
 * Modulo della CLI `migrazione:riconcilia` (`NestFactory.createApplicationContext`). Come
 * `MigrazioneModule`: fornisce SOLO il client applicativo (RLS) e non importa `PrismaModule`, che espone
 * anche il client di sistema (provato da `migrazione.module.spec.ts`).
 */
import { Module } from '@nestjs/common'
import { LoggerModule } from '../../../core/logger/logger.module'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { RiconciliazioneService } from './riconciliazione.service'

@Module({
  imports: [LoggerModule],
  providers: [
    { provide: PrismaService, useFactory: () => creaPrismaServiceApplicativo() },
    RiconciliazioneService,
  ],
  exports: [RiconciliazioneService],
})
export class MigrazioneRiconciliaModule {}
