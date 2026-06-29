/**
 * FIR Module - Dependency Injection
 * Configurazione modulo FIR con use cases, queries e repositories
 */

import { Module } from '@nestjs/common'
// Ciclo di vita FIR completo (create/list/get + emetti/presa-in-carico/conferma-consegna).
// Sostituisce il controller base (solo create/list): entrambi userebbero la rotta @Controller('fir').
import { FIRControllerV2 } from '../api/fir/fir.controller.v2'
import { CreateFIRUseCase } from '../application/fir/use-cases/create-fir.use-case'
import { EmettiFIRUseCase } from '../application/fir/use-cases/emetti-fir.use-case'
import { PresaInCaricoFIRUseCase } from '../application/fir/use-cases/presa-in-carico-fir.use-case'
import { ConfermaConsegnaFIRUseCase } from '../application/fir/use-cases/conferma-consegna-fir.use-case'
import { AnnullaFIRUseCase } from '../application/fir/use-cases/annulla-fir.use-case'
import { ListFIRsQueryHandler } from '../application/fir/queries/list-firs.handler'
import { GetFIRByIdQueryHandler } from '../application/fir/queries/get-fir-by-id.handler'
import { FIRPrismaRepository } from '../infrastructure/persistence/fir-prisma.repository'
import { CERPrismaRepository } from '../infrastructure/persistence/cer-prisma.repository'
import { ProduttorePrismaRepository } from '../infrastructure/persistence/produttore-prisma.repository'
import { TrasportatorePrismaRepository } from '../infrastructure/persistence/trasportatore-prisma.repository'
import { DestinatarioPrismaRepository } from '../infrastructure/persistence/destinatario-prisma.repository'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { BillingModule } from '../application/billing/billing.module'

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [FIRControllerV2],
  providers: [
    // Repositories (provide as concrete classes)
    FIRPrismaRepository,
    CERPrismaRepository,
    ProduttorePrismaRepository,
    TrasportatorePrismaRepository,
    DestinatarioPrismaRepository,

    // Use Cases
    {
      provide: CreateFIRUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        cerRepo: CERPrismaRepository,
        produttoreRepo: ProduttorePrismaRepository,
        trasportatoreRepo: TrasportatorePrismaRepository,
        destinatarioRepo: DestinatarioPrismaRepository,
      ) => {
        return new CreateFIRUseCase(
          firRepo,
          cerRepo,
          produttoreRepo,
          trasportatoreRepo,
          destinatarioRepo,
        )
      },
      inject: [
        FIRPrismaRepository,
        CERPrismaRepository,
        ProduttorePrismaRepository,
        TrasportatorePrismaRepository,
        DestinatarioPrismaRepository,
      ],
    },
    {
      provide: EmettiFIRUseCase,
      useFactory: (firRepo: FIRPrismaRepository) => {
        return new EmettiFIRUseCase(firRepo)
      },
      inject: [FIRPrismaRepository],
    },
    {
      provide: PresaInCaricoFIRUseCase,
      useFactory: (firRepo: FIRPrismaRepository) => {
        return new PresaInCaricoFIRUseCase(firRepo)
      },
      inject: [FIRPrismaRepository],
    },
    {
      provide: ConfermaConsegnaFIRUseCase,
      useFactory: (firRepo: FIRPrismaRepository) => {
        return new ConfermaConsegnaFIRUseCase(firRepo)
      },
      inject: [FIRPrismaRepository],
    },
    {
      provide: AnnullaFIRUseCase,
      useFactory: (firRepo: FIRPrismaRepository) => {
        return new AnnullaFIRUseCase(firRepo)
      },
      inject: [FIRPrismaRepository],
    },

    // Queries
    {
      provide: ListFIRsQueryHandler,
      useFactory: (firRepo: FIRPrismaRepository) => {
        return new ListFIRsQueryHandler(firRepo)
      },
      inject: [FIRPrismaRepository],
    },
    {
      provide: GetFIRByIdQueryHandler,
      useFactory: (firRepo: FIRPrismaRepository) => {
        return new GetFIRByIdQueryHandler(firRepo)
      },
      inject: [FIRPrismaRepository],
    },
  ],
  exports: [
    CreateFIRUseCase,
    EmettiFIRUseCase,
    PresaInCaricoFIRUseCase,
    ConfermaConsegnaFIRUseCase,
    AnnullaFIRUseCase,
    ListFIRsQueryHandler,
    GetFIRByIdQueryHandler,
  ],
})
export class FIRModule {}
