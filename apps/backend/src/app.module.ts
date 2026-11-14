/**
 * App Module - Root Module
 * Configures all domain modules and infrastructure
 */

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { LIMITI_GLOBALI } from './core/http/limiti-globali'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { HttpExceptionFilter } from './core/filters/http-exception.filter'
import { TenantContextMiddleware } from './core/middleware/tenant-context.middleware'
import { TenantSwitchInterceptor } from './core/interceptors/tenant-switch.interceptor'
import { ModuloAttivoInterceptor } from './core/interceptors/modulo-attivo.interceptor'
import { ModuliAttiviModule } from './application/admin/moduli-attivi.module'
import { AuthModule } from './auth/auth.module'
import { PrismaModule } from './infrastructure/persistence/prisma.module'
import { RegistryModule } from './api/registry/registry.module'
import { FIRModule } from './fir/fir.module'
import { CERModule } from './cer/cer.module'

// New modules - Phase 6-13
import { AnalyticsModule } from './application/analytics/analytics.module'
import { NotificationsModule } from './application/notifications/notifications.module'
import { MUDModule } from './application/mud/mud.module'
import { PDFModule } from './infrastructure/pdf/pdf.module'
import { MonitoringModule } from './infrastructure/monitoring/monitoring.module'
import { DashboardModule } from './api/dashboard/dashboard.module'
import { NotificationsApiModule } from './api/notifications/notifications-api.module'
import { PermissionsModule } from './api/permissions/permissions.module'
import { EsgModule } from './application/esg/esg.module'
import { GiacenzeModule } from './application/giacenze/giacenze.module'
import { AbbinamentiModule } from './application/abbinamenti/abbinamenti.module'
import { AnomalyModule } from './application/anomaly/anomaly.module'
import { ContractModule } from './application/contracts/contract.module'
import { ReferenceDataModule } from './application/reference-data/reference-data.module'
import { RentriModule } from './infrastructure/rentri/rentri.module'
import { RentriSyncModule } from './application/rentri/rentri-sync.module'
import { RegistroRentriModule } from './application/rentri/registro/registro-rentri.module'
// Amministrazione piattaforma (SUPER_ADMIN): tenant + utenti (provisioning Keycloak)
import { AdminTenantModule } from './application/admin/admin-tenant.module'
import { AdminUserModule } from './application/admin/admin-user.module'
import { AdminSystemHealthModule } from './application/admin/admin-system-health.module'
// Endpoint "self" utente autenticato (feature abilitate dal piano)
import { MeModule } from './api/me/me.module'
import { RuoloEffettivoModule } from './api/me/ruolo-effettivo.module'
// Firma digitale FIR "pronta-ma-non-collegata" (WS-E)
// Default: sandbox ECDSA effimera. ATTIVARE: SIGNATURE_PROVIDER=qes + TSA_PROVIDER=rfc3161
import { SignaturesModule } from './application/signatures/signatures.module'
// Registro cronologico carico/scarico (WS-C) — art. 190 D.Lgs 152/2006
import { RegistroModule } from './api/registro/registro.module'
import { PeseModule } from './api/pese/pese.module'
import { AgentiPesaIngressoModule } from './api/agenti-pesa/agenti-pesa-ingresso.module'
import { RitiriModule } from './ritiri/ritiri.module'
import { ComunicazioniModule } from './api/comunicazioni/comunicazioni.module'
import { ClientiModule } from './api/clienti/clienti.module'
import { ListinoModule } from './api/listino/listino.module'
import { ModelliStampaModule } from './api/modelli-stampa/modelli-stampa.module'
import { FatturazioneModule } from './api/fatturazione/fatturazione.module'
import { LegamiMovimentoModule } from './api/legami-movimento/legami-movimento.module'
// Billing SaaS (WS-F): Stripe + enforcement limiti di piano
import { BillingModule } from './application/billing/billing.module'
// Richiesta di accesso (lead capture): il form pubblico NON crea più un tenant.
// La prova guidata (TRIAL) è attivata dal commerciale via provisioning admin.
import { AccessRequestModule } from './application/access-request/access-request.module'

@Module({
  imports: [
    // Environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Metriche Prometheus esposte su GET /metrics (escluso dal global prefix api/v1).
    // Il percorso standard /metrics è usato dallo scraper Prometheus in /opt/observability/.
    // Protezione: solo loopback/rete interna (nginx non espone /metrics pubblicamente).
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),

    // Event system per eventi di dominio (firma, audit) — global per tutti i moduli
    EventEmitterModule.forRoot({ global: true }),

    // Scheduled tasks (T131)
    ScheduleModule.forRoot(),

    // Security: Rate Limiting (T254)
    ThrottlerModule.forRoot(LIMITI_GLOBALI),

    // Infrastructure
    PrismaModule,

    // Authentication & Authorization
    AuthModule,
    // Globale: RolesGuard lo risolve in ogni modulo (ruolo nell'azienda selezionata)
    RuoloEffettivoModule,

    // Domain modules
    RegistryModule,
    FIRModule,
    CERModule,

    // Analytics & Reporting
    AnalyticsModule,
    MUDModule,
    EsgModule,
    GiacenzeModule,
    AbbinamentiModule,
    AnomalyModule,
    ContractModule,
    ReferenceDataModule,

    // RENTRI interoperability (client + gestione certificato per-tenant)
    RentriModule,
    // RENTRI sync — use case/coda/worker/log/controller (R0 Task 4: cablati,
    // prima erano otto pezzi orfani non raggiungibili da AppModule)
    RentriSyncModule,
    // RENTRI — trasmissione del registro di carico/scarico (F2-9)
    RegistroRentriModule,

    // Communication
    NotificationsModule,

    // File Generation
    PDFModule,

    // Operations
    MonitoringModule,

    // API Modules
    DashboardModule,
    NotificationsApiModule,

    // IAM / RBAC + ABAC (PermissionGuard opt-in via @RequirePermission)
    PermissionsModule,

    // Amministrazione piattaforma (SUPER_ADMIN)
    AdminTenantModule,
    AdminUserModule,
    // Pagina «Stato del sistema» (SUPER_ADMIN): stato verificato di
    // infrastruttura, code, job schedulati e credenziali.
    AdminSystemHealthModule,

    // Endpoint "self" utente autenticato
    MeModule,
    ModuliAttiviModule,

    // Firma digitale FIR (WS-E) — cablato e raggiungibile; default sandbox
    SignaturesModule,

    // Registro cronologico carico/scarico (WS-C) — art. 190 D.Lgs 152/2006
    RegistroModule,
    PeseModule,
    AgentiPesaIngressoModule,
    RitiriModule,
    ComunicazioniModule,
    ClientiModule,
    ListinoModule,
    ModelliStampaModule,
    LegamiMovimentoModule,
    FatturazioneModule,

    // Billing SaaS (WS-F): Stripe checkout/webhook/portal + enforcement limiti piano
    BillingModule,

    // Richiesta di accesso (lead capture): POST /auth/access-request pubblico +
    // GET/PATCH /admin/access-requests (SUPER_ADMIN). Nessun tenant creato qui.
    AccessRequestModule,
  ],
  providers: [
    // Filtro eccezioni globale: mappa errori Prisma su status corretti
    // (P2023→400, P2025→404, P2002→409, P2003/P2014→400, ValidationError→400) e
    // impedisce il leak di dettagli interni (Prisma/stack/path) nel body di risposta.
    // Shape flat { statusCode, error, message, correlationId, timestamp, path } —
    // invariata rispetto a quella consumata dal frontend (err.error.message).
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Apply rate limiting globally (T254)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Validazione header X-Tenant-ID per tutti gli utenti (non solo SUPER_ADMIN).
    // Gira dopo i guard Passport (JWT), quindi req.user è disponibile.
    // Dipende da MembershipService esportato da MeModule.
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantSwitchInterceptor,
    },
    // Moduli commerciali chiusi nel backend (`@RichiedeModulo`/`@SenzaModulo`). DEVE stare
    // DOPO TenantSwitchInterceptor: legge l'azienda selezionata gia' validata. Non invertire
    // (c'e' un test sull'ordine).
    {
      provide: APP_INTERCEPTOR,
      useClass: ModuloAttivoInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Popola il TenantContext (AsyncLocalStorage) per ogni richiesta a partire dal
   * JWT: abilita l'isolamento multi-tenant (RLS extension) e sblocca i percorsi di
   * scrittura dei repository (che usano TenantContext.requireTenantId()).
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*')
  }
}
