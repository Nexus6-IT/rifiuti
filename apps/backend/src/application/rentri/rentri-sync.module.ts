import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from '../../core/logger/logger.module'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsModule } from '../../core/metrics/metrics.module'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriModule } from '../../infrastructure/rentri/rentri.module'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { RentriModalitaLegameService } from '../../infrastructure/rentri/rentri-modalita-legame.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { RENTRISyncJobProcessor } from '../../infrastructure/queue/jobs/rentri-sync.job'
import { RENTRISyncController } from '../../api/rentri/rentri-sync.controller'
import { RentriFormulariController } from '../../api/rentri/rentri-formulari.controller'
import { RentriFirLifecycleController } from '../../api/rentri/rentri-fir-lifecycle.controller'
import { DomainEventsService } from '../../core/domain-events.service'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { TriggerBatchSyncUseCase } from './trigger-batch-sync.use-case'
import { GetSyncStatusUseCase } from './get-sync-status.use-case'
import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'
import { ConfermaLegameRENTRIUseCase } from './conferma-legame-rentri.use-case'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'
import { CercaFormulariRENTRIUseCase } from './cerca-formulari-rentri.use-case'
import { AcquisisciFormularioRENTRIUseCase } from './acquisisci-formulario-rentri.use-case'
import { RilasciaFormularioRENTRIUseCase } from './rilascia-formulario-rentri.use-case'
import { CREA_FIR_DA_FORMULARIO_RENTRI_PORT } from './crea-fir-da-formulario-rentri.port'
import { CreaFIRDaDettaglioRENTRIUseCase } from './crea-fir-da-dettaglio-rentri.use-case'
import { RiconciliaStatoRentriUseCase } from './riconcilia-stato-rentri.use-case'
import { RentriRiconciliazioneJob } from '../../infrastructure/jobs/rentri-riconciliazione.job'
import { RentriCertificatoScadenzaJob } from '../../infrastructure/jobs/rentri-certificato-scadenza.job'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import { MetricsService } from '../../core/metrics/metrics.service'
import { CompletaOperazioneConFirmaUseCase } from './completa-operazione-con-firma.use-case'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { RentriRateLimiterService } from '../../infrastructure/rentri/rentri-rate-limiter.service'
import { AccettaORespingiFIRUseCase } from './accetta-o-respingi-fir.use-case'
import { AnnullaFIRRentriUseCase } from './annulla-fir-rentri.use-case'
import { GestisciAllegatiFIRUseCase } from './gestisci-allegati-fir.use-case'
import { ScaricaPdfFirUseCase } from './scarica-pdf-fir.use-case'

/**
 * RentriSyncModule — cablaggio del sottosistema di sincronizzazione RENTRI (R0 Task 4).
 *
 * Prima di questo modulo gli otto pezzi elencati sotto esistevano già (modello
 * dati, metodi di dominio, persistenza reale) ma non erano registrati in
 * ALCUN `@Module`: `SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`,
 * `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncJobProcessor`,
 * `RENTRISyncLogRepository`, `FIRConsegnatoHandler` (rimosso, v. sotto),
 * `RENTRISyncController` — codice morto dal punto di vista di Nest, i cinque
 * endpoint del controller rispondevano 404.
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
 * **R1 Task 2 — orchestrazione secondo la modalità del tenant, e la fine di
 * `FIRConsegnatoHandler`.** Quel handler era cablato in DI ma NON scattava
 * mai: l'aggregate FIR emette eventi `DomainEvent` (`{occurredOn, eventName}`,
 * v. `core/domain/aggregate-root.ts`), mentre `DomainEventsService`/
 * `IDomainEventHandler` parlano `IDomainEvent` (`{eventId, aggregateId,
 * eventType, tenantId, payload}`, v. `domain/shared/domain-event.interface.ts`)
 * — due famiglie mai riconciliate nel progetto (nessuna `.register(...)`
 * esiste). Riconciliarle avrebbe richiesto un adattatore generale toccando
 * ogni evento/handler del progetto: sproporzionato per questo task, e non
 * necessario, perché il punto di aggancio richiesto (trasmissione secondo
 * la modalità del tenant all'emissione) ha un solo produttore
 * (`EmettiFIRUseCase`) e un solo consumatore (`TrasmettiFIRSecondoModalitaUseCase`,
 * v. commento nel file). Si è scelta l'invocazione diretta, non l'evento.
 * `FIRConsegnatoHandler` è stato quindi RIMOSSO (non lasciato a sembrare
 * vivo): oltre a non scattare mai, era anche modalità-agnostico — se un
 * domani l'inconsistenza fosse stata risolta e l'evento avesse iniziato a
 * scattare, avrebbe accodato una sincronizzazione a prescindere dalla
 * modalità del tenant, violando "in MANUALE nulla parte da solo".
 *
 * `TrasmettiFIRSecondoModalitaUseCase` (chiamato da `EmettiFIRUseCase` dopo
 * l'emissione) decide se accodare una trasmissione, fail-closed se il
 * certificato manca. `ConfermaLegameRENTRIUseCase` chiude il ciclo aperto
 * dalla modalità IBRIDA (`FIR.proporreLegameRENTRI`): senza di esso l'IBRIDA
 * sarebbe un aggancio che parte ma non si conclude mai.
 *
 * **R2 Task 4 — orchestrazione cercare→verificare→acquisire un formulario
 * esistente.** `CercaFormulariRENTRIUseCase`, `AcquisisciFormularioRENTRIUseCase`
 * e `RilasciaFormularioRENTRIUseCase` chiudono il caso complementare a
 * quello sopra: un formulario che ESISTE GIÀ su RENTRI (creato da un'altra
 * controparte), da trovare e agganciare senza ri-agganciarlo due volte (v. i
 * commenti di classe di ciascun use case per l'ordine delle scritture RENTRI
 * ↔ locale e come si ripara un'eventuale incoerenza). `RentriUnitaLocaleService`
 * (da `RentriModule`, già importato) serve al prerequisito fail-closed della
 * ricerca. `AcquisisciFormularioRENTRIUseCase` dipende dalla porta
 * `CREA_FIR_DA_FORMULARIO_RENTRI_PORT`: registrata ora con l'implementazione
 * reale `CreaFIRDaDettaglioRENTRIUseCase` (Task 5) — mappa il dettaglio
 * RENTRI (`GET /{numero_fir}`) su un FIR locale, v. commento di classe di
 * quel use case per le decisioni di prodotto (snapshot immutabile, campo
 * obbligatorio mancante → rifiuto esplicito, nessuna validazione del CER
 * contro il catalogo). Sostituisce il precedente adapter placeholder
 * (rimosso, v. `crea-fir-da-formulario-rentri.non-implementato.adapter.ts`,
 * non più registrato).
 *
 * R2 Task 6 — endpoint REST dell'aggancio. `RentriFormulariController`
 * espone `CercaFormulariRENTRIUseCase`/`AcquisisciFormularioRENTRIUseCase`/
 * `RilasciaFormularioRENTRIUseCase` (già cablati sopra per Task 4) come
 * `GET /rentri/formulari` + `POST /rentri/formulari/:numeroFir/aggancia` +
 * `POST /rentri/fir/:id/rilascia-legame-rentri`. Controller DEDICATO (non
 * un'estensione di `RENTRISyncController`, già ~490 righe su un dominio
 * distinto — trasmissione IN USCITA verso RENTRI): v. commento di testata
 * di `rentri-formulari.controller.ts` per la motivazione completa. Dipende
 * anche da `RentriUnitaLocaleService` (già importato da `RentriModule`) per
 * risolvere la sede su cui acquisire/rilasciare la visibilità.
 *
 * R3 Task 2 — "il motore della UI". `GetAzioniDisponibiliUseCase` espone
 * `GET /rentri/fir/:id/azioni` (`RentriFirLifecycleController`, DEDICATO:
 * dominio ancora diverso, il ciclo di vita del formulario già agganciato,
 * non "trasmissione in uscita" né "cercare→agganciare"): interroga
 * `RENTRIApiClient.leggiAzioniDisponibili` e riconcilia lo stato del FIR
 * (`FIR.applyRentriStato`, Task 1) a ogni lettura. Ogni operazione di
 * scrittura futura (Task 4+) dovrà verificare qui PRIMA di agire, per non
 * incorrere nel 423 dell'ente.
 */
@Module({
  imports: [ConfigModule, LoggerModule, MetricsModule, PrismaModule, RentriModule],
  controllers: [RENTRISyncController, RentriFormulariController, RentriFirLifecycleController],
  providers: [
    FIRPrismaRepository,
    RENTRISyncQueue,
    RENTRISyncJobProcessor,
    GetSyncStatusUseCase,
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
    {
      provide: TrasmettiFIRSecondoModalitaUseCase,
      useFactory: (
        modalitaLegameService: RentriModalitaLegameService,
        rentriSyncQueue: RENTRISyncQueue,
        logger: LoggerService
      ) => new TrasmettiFIRSecondoModalitaUseCase(modalitaLegameService, rentriSyncQueue, logger),
      inject: [RentriModalitaLegameService, RENTRISyncQueue, LoggerService],
    },
    {
      provide: ConfermaLegameRENTRIUseCase,
      useFactory: (firRepo: FIRPrismaRepository, logger: LoggerService) =>
        new ConfermaLegameRENTRIUseCase(firRepo, logger),
      inject: [FIRPrismaRepository, LoggerService],
    },
    {
      provide: CercaFormulariRENTRIUseCase,
      useFactory: (
        prisma: PrismaService,
        unitaLocaleService: RentriUnitaLocaleService,
        rentriApiClient: RENTRIApiClient,
        firRepo: FIRPrismaRepository,
        logger: LoggerService
      ) =>
        new CercaFormulariRENTRIUseCase(
          prisma,
          unitaLocaleService,
          rentriApiClient,
          firRepo,
          logger
        ),
      inject: [
        PrismaService,
        RentriUnitaLocaleService,
        RENTRIApiClient,
        FIRPrismaRepository,
        LoggerService,
      ],
    },
    {
      provide: CREA_FIR_DA_FORMULARIO_RENTRI_PORT,
      useClass: CreaFIRDaDettaglioRENTRIUseCase,
    },
    {
      provide: AcquisisciFormularioRENTRIUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        rentriApiClient: RENTRIApiClient,
        prisma: PrismaService,
        creaFirPort: CreaFIRDaDettaglioRENTRIUseCase,
        logger: LoggerService
      ) =>
        new AcquisisciFormularioRENTRIUseCase(
          firRepo,
          rentriApiClient,
          prisma,
          creaFirPort,
          logger
        ),
      inject: [
        FIRPrismaRepository,
        RENTRIApiClient,
        PrismaService,
        CREA_FIR_DA_FORMULARIO_RENTRI_PORT,
        LoggerService,
      ],
    },
    {
      provide: RilasciaFormularioRENTRIUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        rentriApiClient: RENTRIApiClient,
        prisma: PrismaService,
        logger: LoggerService
      ) => new RilasciaFormularioRENTRIUseCase(firRepo, rentriApiClient, prisma, logger),
      inject: [FIRPrismaRepository, RENTRIApiClient, PrismaService, LoggerService],
    },
    // R5 Task 4 — riconciliazione periodica (v. commento di classe del use
    // case per la decisione "corregge solo se riempie un buco, altrimenti
    // segnala"). Stesso pattern di useFactory di sopra: IFIRRepository e'
    // un'interfaccia, Nest non puo' risolverla da un tipo di parametro.
    {
      provide: RiconciliaStatoRentriUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        prisma: PrismaService,
        rentriApiClient: RENTRIApiClient,
        syncLogRepo: RENTRISyncLogRepository,
        domainEvents: DomainEventsService,
        logger: LoggerService,
        metrics: MetricsService
      ) =>
        new RiconciliaStatoRentriUseCase(
          firRepo,
          prisma,
          rentriApiClient,
          syncLogRepo,
          domainEvents,
          logger,
          metrics
        ),
      inject: [
        FIRPrismaRepository,
        PrismaService,
        RENTRIApiClient,
        RENTRISyncLogRepository,
        DomainEventsService,
        LoggerService,
        MetricsService,
      ],
    },
    RentriRiconciliazioneJob,
    // R5 Task 5 — allarmi: alimenta wasteflow_rentri_certificate_expiry_days
    // una volta al giorno (v. commento di classe del job).
    RentriCertificatoScadenzaJob,
    // R3 Task 2 — consultazione di stato e azioni disponibili presso l'ente:
    // e' la fonte di verita' per quali pulsanti mostrare, e la difesa contro il
    // 423 (chiamare un'operazione che l'ente non consente e' precisamente la
    // richiesta "autenticata ma non valida" che fa bandire il chiamante).
    {
      provide: GetAzioniDisponibiliUseCase,
      useFactory: (
        prisma: PrismaService,
        firRepo: FIRPrismaRepository,
        rentriApiClient: RENTRIApiClient,
        logger: LoggerService
      ) => new GetAzioniDisponibiliUseCase(prisma, firRepo, rentriApiClient, logger),
      inject: [PrismaService, FIRPrismaRepository, RENTRIApiClient, LoggerService],
    },
    // R3 Task 3 — infrastruttura comune di completamento con FIRMA REMOTA
    // RENTRI (v. `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`).
    // Nessun controller in questo task: l'endpoint che lo esporrà è compito
    // dei Task 4-7, che lo invocheranno passando il proprio `tipoOperazione`.
    // Registrato ora comunque, non lasciato scollegato: il difetto ricorrente
    // di questo progetto è precisamente il sottosistema scritto e mai cablato.
    // `useFactory` per lo stesso motivo degli altri: `IFIRRepository` è
    // un'interfaccia e sparisce a runtime.
    {
      provide: CompletaOperazioneConFirmaUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        credentialService: RentriCredentialService,
        rentriApiClient: RENTRIApiClient,
        rateLimiter: RentriRateLimiterService,
        logger: LoggerService
      ) =>
        new CompletaOperazioneConFirmaUseCase(
          firRepo,
          credentialService,
          rentriApiClient,
          rateLimiter,
          logger
        ),
      inject: [
        FIRPrismaRepository,
        RentriCredentialService,
        RENTRIApiClient,
        RentriRateLimiterService,
        LoggerService,
      ],
    },
    // R3 Task 4 — prima operazione di scrittura reale del ciclo: accettazione
    // (anche parziale) o respingimento del carico da parte del destinatario.
    // Riusa `GetAzioniDisponibiliUseCase` per la precondizione da `/azioni` e
    // `CompletaOperazioneConFirmaUseCase` per chiudere il ciclo con la firma
    // remota — nessuna duplicazione del lookup del CF tenant né del ciclo di
    // firma. `useFactory` per lo stesso motivo degli altri: `IFIRRepository`
    // è un'interfaccia e sparisce a runtime.
    {
      provide: AccettaORespingiFIRUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
        rentriApiClient: RENTRIApiClient,
        completaOperazioneConFirmaUseCase: CompletaOperazioneConFirmaUseCase,
        logger: LoggerService
      ) =>
        new AccettaORespingiFIRUseCase(
          firRepo,
          getAzioniDisponibiliUseCase,
          rentriApiClient,
          completaOperazioneConFirmaUseCase,
          logger
        ),
      inject: [
        FIRPrismaRepository,
        GetAzioniDisponibiliUseCase,
        RENTRIApiClient,
        CompletaOperazioneConFirmaUseCase,
        LoggerService,
      ],
    },
    // R3 Task 5 — annullamento del formulario, con nota. Stesse quattro
    // dipendenze di AccettaORespingiFIRUseCase, stesso motivo: riusa la
    // precondizione da /azioni e il ciclo di firma remota senza duplicarli.
    {
      provide: AnnullaFIRRentriUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
        rentriApiClient: RENTRIApiClient,
        completaOperazioneConFirmaUseCase: CompletaOperazioneConFirmaUseCase,
        logger: LoggerService
      ) =>
        new AnnullaFIRRentriUseCase(
          firRepo,
          getAzioniDisponibiliUseCase,
          rentriApiClient,
          completaOperazioneConFirmaUseCase,
          logger
        ),
      inject: [
        FIRPrismaRepository,
        GetAzioniDisponibiliUseCase,
        RENTRIApiClient,
        CompletaOperazioneConFirmaUseCase,
        LoggerService,
      ],
    },
    // R3 Task 6 — allegati del formulario. NESSUNA firma (il contratto la
    // dichiara superflua per questa operazione, v. commento di classe):
    // niente `CompletaOperazioneConFirmaUseCase` a differenza degli use case
    // sopra. Persistenza locale via `PrismaService` diretto (`fIRAllegatoRentri`),
    // stesso stile di `GetAzioniDisponibiliUseCase` con `prisma.tenant`.
    {
      provide: GestisciAllegatiFIRUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        prisma: PrismaService,
        getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
        rentriApiClient: RENTRIApiClient,
        logger: LoggerService
      ) =>
        new GestisciAllegatiFIRUseCase(
          firRepo,
          prisma,
          getAzioniDisponibiliUseCase,
          rentriApiClient,
          logger
        ),
      inject: [
        FIRPrismaRepository,
        PrismaService,
        GetAzioniDisponibiliUseCase,
        RENTRIApiClient,
        LoggerService,
      ],
    },
    // R3 Task 7 — stampa PDF (proxy dello stream, mai un redirect al
    // portale) e "aggiorna lo stato" (riusa `GetAzioniDisponibiliUseCase`,
    // nessun nuovo endpoint: v. commento di classe del controller). NESSUNA
    // firma, NESSUN ciclo NONBLOCK_PULL: `GET /{numero_fir}/pdf` è
    // sincrono. `useFactory` per lo stesso motivo degli altri:
    // `IFIRRepository` è un'interfaccia e sparisce a runtime.
    {
      provide: ScaricaPdfFirUseCase,
      useFactory: (
        firRepo: FIRPrismaRepository,
        rentriApiClient: RENTRIApiClient,
        logger: LoggerService
      ) => new ScaricaPdfFirUseCase(firRepo, rentriApiClient, logger),
      inject: [FIRPrismaRepository, RENTRIApiClient, LoggerService],
    },
  ],
  exports: [
    SyncFIRToRENTRIUseCase,
    TriggerBatchSyncUseCase,
    GetSyncStatusUseCase,
    RENTRISyncQueue,
    RENTRISyncLogRepository,
    TrasmettiFIRSecondoModalitaUseCase,
    ConfermaLegameRENTRIUseCase,
    CercaFormulariRENTRIUseCase,
    AcquisisciFormularioRENTRIUseCase,
    RilasciaFormularioRENTRIUseCase,
    RiconciliaStatoRentriUseCase,
    GetAzioniDisponibiliUseCase,
    CompletaOperazioneConFirmaUseCase,
    AccettaORespingiFIRUseCase,
    AnnullaFIRRentriUseCase,
    GestisciAllegatiFIRUseCase,
    ScaricaPdfFirUseCase,
  ],
})
export class RentriSyncModule {}
