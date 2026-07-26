import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from '../../core/logger/logger.module'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsModule } from '../../core/metrics/metrics.module'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriModule } from '../../infrastructure/rentri/rentri.module'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { RENTRISyncJobProcessor } from '../../infrastructure/queue/jobs/rentri-sync.job'
import { RENTRISyncController } from '../../api/rentri/rentri-sync.controller'
import { DomainEventsService } from '../../core/domain-events.service'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { TriggerBatchSyncUseCase } from './trigger-batch-sync.use-case'
import { GetSyncStatusUseCase } from './get-sync-status.use-case'
import { FIRConsegnatoHandler } from './handlers/fir-consegnato.handler'

/**
 * RentriSyncModule — cablaggio del sottosistema di sincronizzazione RENTRI (R0 Task 4).
 *
 * Prima di questo modulo gli otto pezzi elencati sotto esistevano già (modello
 * dati, metodi di dominio, persistenza reale) ma non erano registrati in
 * ALCUN `@Module`: `SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`,
 * `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncJobProcessor`,
 * `RENTRISyncLogRepository`, `FIRConsegnatoHandler`, `RENTRISyncController` —
 * codice morto dal punto di vista di Nest, i cinque endpoint del controller
 * rispondevano 404.
 *
 * Perché un modulo DEDICATO e non un'estensione di `RentriModule`:
 * `RentriModule` è il sottosistema di interoperabilità "a canale singolo"
 * (client HTTP, autenticazione ModI, firma, credenziali per-tenant) — la sua
 * responsabilità finisce alla singola chiamata REST. Questo modulo aggiunge
 * un layer applicativo interamente diverso (use case, coda BullMQ, worker,
 * repository di log, handler di eventi, controller REST) che ORCHESTRA
 * `RentriModule` invece di farne parte: infilarlo in `RentriModule` ne
 * avrebbe raddoppiato la superficie e mescolato "parlare con RENTRI" con
 * "decidere quando e cosa sincronizzare". `RentriSyncModule` importa
 * `RentriModule` solo per il pezzo che gli serve (`RENTRIApiClient`, già
 * esportato), mantenendo la separazione.
 *
 * Note di cablaggio (i tre difetti trovati in ricognizione, oltre ai tipi `any`):
 *
 * 1. `IFIRRepository` è un'interfaccia: sparisce a runtime, Nest non può
 *    risolverla da un tipo di parametro. `SyncFIRToRENTRIUseCase` e
 *    `TriggerBatchSyncUseCase` sono quindi registrati con `useFactory` +
 *    `inject: [FIRPrismaRepository]` (stesso pattern già in uso in
 *    `fir/fir.module.ts` per gli use case del ciclo di vita): il factory
 *    costruisce l'istanza a mano, passando la classe concreta dove
 *    l'interfaccia la richiede — a compile time i tipi restano quelli reali
 *    (niente `any`), a runtime la risoluzione è esplicita.
 * 2. `RENTRISyncLogRepository` aveva un secondo parametro `tenantId: string`
 *    nel costruttore: un primitivo non risolvibile da Nest, e comunque
 *    sbagliato per un provider singleton multi-tenant. Il costruttore è stato
 *    corretto a monte (risolve il tenant da `TenantContext`, come gli altri
 *    repository del progetto), qui basta una `useFactory` con
 *    `inject: [PrismaService]` (che estende `PrismaClient`, quindi soddisfa
 *    il tipo del parametro).
 * 3. `RENTRISyncQueue`/`RENTRISyncJobProcessor` NON usano `@nestjs/bullmq`
 *    (niente `BullModule.registerQueue`/`@InjectQueue`): aprono la propria
 *    connessione Redis "a mano" dentro `onModuleInit`. Sono quindi registrati
 *    come provider Nest normali — Nest li istanzia e basta, la gestione della
 *    connessione resta interamente loro. Questo È il motivo per cui un
 *    `Test.createTestingModule(...).compile()` ingenuo NON si blocca da solo:
 *    `.compile()` risolve il grafo DI ma non invoca `onModuleInit` (v.
 *    `rentri-sync.module.spec.ts`, che verifica proprio questo).
 *
 * `FIRConsegnatoHandler` è cablato in DI (non più orfano) ma NON scatta ancora
 * automaticamente alla consegna di un FIR: l'aggregate FIR emette eventi
 * `DomainEvent` (`eventName`), mentre questo handler/`DomainEventsService`
 * parlano `IDomainEvent` (`eventType`) — due famiglie di eventi incompatibili
 * mai riconciliate nel progetto (nessuna `.register(...)` esiste). Risolverlo
 * è fuori scope per un task di solo cablaggio (v. report R0 Task 4).
 */
@Module({
  imports: [ConfigModule, LoggerModule, MetricsModule, PrismaModule, RentriModule],
  controllers: [RENTRISyncController],
  providers: [
    FIRPrismaRepository,
    RENTRISyncQueue,
    RENTRISyncJobProcessor,
    GetSyncStatusUseCase,
    FIRConsegnatoHandler,
    DomainEventsService,
    {
      provide: RENTRISyncLogRepository,
      useFactory: (prisma: PrismaService) => new RENTRISyncLogRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: SyncFIRToRENTRIUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        rentriApiClient: RENTRIApiClient,
        syncLogRepo: RENTRISyncLogRepository,
        domainEvents: DomainEventsService,
        logger: LoggerService
      ) => new SyncFIRToRENTRIUseCase(firRepo, rentriApiClient, syncLogRepo, domainEvents, logger),
      inject: [
        FIRPrismaRepository,
        RENTRIApiClient,
        RENTRISyncLogRepository,
        DomainEventsService,
        LoggerService,
      ],
    },
    {
      provide: TriggerBatchSyncUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        rentriSyncQueue: RENTRISyncQueue,
        logger: LoggerService
      ) => new TriggerBatchSyncUseCase(firRepo, rentriSyncQueue, logger),
      inject: [FIRPrismaRepository, RENTRISyncQueue, LoggerService],
    },
  ],
  exports: [
    SyncFIRToRENTRIUseCase,
    TriggerBatchSyncUseCase,
    GetSyncStatusUseCase,
    RENTRISyncQueue,
    RENTRISyncLogRepository,
    FIRConsegnatoHandler,
  ],
})
export class RentriSyncModule {}
