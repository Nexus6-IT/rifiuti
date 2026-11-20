/**
 * Modulo della CLI `migrazione:riacquisisci-fir`. Fornisce SOLO cio' che serve a leggere un
 * formulario dall'ente e creare il FIR locale (`AcquisisciFormularioRENTRIUseCase`): client RENTRI
 * (`RentriModule`), repository dei FIR e porta di creazione.
 *
 * NON importa il sottosistema di sincronizzazione: i suoi provider includono il worker della coda
 * `rentri-sync` e la coda stessa, che all'avvio del contesto Nest comincerebbero a consumare job
 * reali e a trasmettere FIR normali a RENTRI da un comando dichiarato in sola lettura. Un test
 * chiama `init()` e prova che nessun worker ne' coda vengono creati.
 */
import { Module } from '@nestjs/common'
import { RuoloEffettivoModule } from '../../../api/me/ruolo-effettivo.module'
import { LoggerModule } from '../../../core/logger/logger.module'
import { LoggerService } from '../../../core/logger/logger.service'
import { RentriModule } from '../../../infrastructure/rentri/rentri.module'
import { RENTRIApiClient } from '../../../infrastructure/rentri/rentri-api.client'
import { FIRPrismaRepository } from '../../../infrastructure/persistence/fir-prisma.repository'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { AcquisisciFormularioRENTRIUseCase } from '../../rentri/acquisisci-formulario-rentri.use-case'
import { CreaFIRDaDettaglioRENTRIUseCase } from '../../rentri/crea-fir-da-dettaglio-rentri.use-case'
import { CREA_FIR_DA_FORMULARIO_RENTRI_PORT } from '../../rentri/crea-fir-da-formulario-rentri.port'
import { ArchivioRiacquisizionePrisma } from './archivio-riacquisizione.prisma'
import { RiacquisisciFirService } from './riacquisisci-fir.service'

@Module({
  // RuoloEffettivoModule: i controller di RentriModule hanno i guard dei ruoli (qui non si servono).
  imports: [LoggerModule, RentriModule, RuoloEffettivoModule],
  providers: [
    FIRPrismaRepository,
    { provide: CREA_FIR_DA_FORMULARIO_RENTRI_PORT, useClass: CreaFIRDaDettaglioRENTRIUseCase },
    {
      provide: AcquisisciFormularioRENTRIUseCase,
      useFactory: (
        repo: FIRPrismaRepository,
        client: RENTRIApiClient,
        prisma: PrismaService,
        port: CreaFIRDaDettaglioRENTRIUseCase,
        logger: LoggerService
      ) => new AcquisisciFormularioRENTRIUseCase(repo, client, prisma, port, logger),
      inject: [
        FIRPrismaRepository,
        RENTRIApiClient,
        PrismaService,
        CREA_FIR_DA_FORMULARIO_RENTRI_PORT,
        LoggerService,
      ],
    },
    {
      provide: RiacquisisciFirService,
      useFactory: (
        caso: AcquisisciFormularioRENTRIUseCase,
        prisma: PrismaService,
        logger: LoggerService
      ) =>
        new RiacquisisciFirService(
          {
            // Contesto dell'azienda: RLS su firs, credenziali RENTRI e utenti.
            acquisisci: input =>
              TenantContext.run({ tenantId: input.tenantId, userId: input.userId }, () =>
                caso.execute(input)
              ),
          },
          new ArchivioRiacquisizionePrisma(prisma),
          logger
        ),
      inject: [AcquisisciFormularioRENTRIUseCase, PrismaService, LoggerService],
    },
  ],
  exports: [RiacquisisciFirService],
})
export class RiacquisizioneFirModule {}
