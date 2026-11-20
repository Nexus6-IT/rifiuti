/**
 * Modulo della CLI `migrazione:riacquisisci-fir`. A differenza di `MigrazioneModule` (che carica
 * solo col client applicativo) qui serve il sottosistema RENTRI esistente, perche' la riacquisizione
 * usa `AcquisisciFormularioRENTRIUseCase` (lettura del formulario dall'ente e creazione del FIR
 * locale con le regole di sempre). Il servizio non ha accesso al client RENTRI: vede solo il caso
 * d'uso, e lo chiama in sola lettura (vedi `riacquisisci-fir.service.ts`).
 */
import { Module } from '@nestjs/common'
import { LoggerModule } from '../../../core/logger/logger.module'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { AcquisisciFormularioRENTRIUseCase } from '../../rentri/acquisisci-formulario-rentri.use-case'
import { RentriSyncModule } from '../../rentri/rentri-sync.module'
import { ArchivioRiacquisizionePrisma } from './archivio-riacquisizione.prisma'
import { RiacquisisciFirService } from './riacquisisci-fir.service'

@Module({
  imports: [LoggerModule, RentriSyncModule],
  providers: [
    {
      provide: RiacquisisciFirService,
      useFactory: (
        caso: AcquisisciFormularioRENTRIUseCase,
        prisma: PrismaService,
        logger: LoggerService
      ) =>
        new RiacquisisciFirService(
          { acquisisci: input => caso.execute(input) },
          new ArchivioRiacquisizionePrisma(prisma),
          logger
        ),
      inject: [AcquisisciFormularioRENTRIUseCase, PrismaService, LoggerService],
    },
  ],
  exports: [RiacquisisciFirService],
})
export class RiacquisizioneFirModule {}
