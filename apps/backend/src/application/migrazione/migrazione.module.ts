/**
 * Modulo di migrazione per la CLI `migrazione:carica` (`NestFactory.createApplicationContext`).
 * Volutamente minimo: fornisce SOLO il client applicativo (RLS) e non importa `PrismaModule`, che
 * espone anche il client di sistema. Un test d'architettura (`migrazione.module.spec.ts`) lo prova.
 */
import { Module } from '@nestjs/common'
import { LoggerModule } from '../../core/logger/logger.module'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { CaricaPacchettoService } from './caricamento/carica-pacchetto.service'
import { LottiImportService } from './caricamento/lotti-import.service'

@Module({
  imports: [LoggerModule],
  providers: [
    { provide: PrismaService, useFactory: () => creaPrismaServiceApplicativo() },
    LottiImportService,
    CaricaPacchettoService,
  ],
  exports: [CaricaPacchettoService],
})
export class MigrazioneModule {}
