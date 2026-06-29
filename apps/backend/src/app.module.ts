/**
 * App Module - Root Module
 * Configures all domain modules and infrastructure
 */

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { TenantContextMiddleware } from './core/middleware/tenant-context.middleware'
import { TenantSwitchInterceptor } from './core/interceptors/tenant-switch.interceptor'
import { HealthController } from './api/health/health.controller'
import { AuthModule } from './auth/auth.module'
import { PrismaModule } from './infrastructure/persistence/prisma.module'
import { RegistryModule } from './api/registry/registry.module'
import { FIRModule } from './fir/fir.module'
import { CERModule } from './cer/cer.module'

// New modules - Phase 6-13
import { AnalyticsModule } from './application/analytics/analytics.module'
import { NotificationsModule } from './application/notifications/notifications.module'
import { MUDModule } from './application/mud/mud.module'
import { BackupModule } from './infrastructure/backup/backup.module'
import { PDFModule } from './infrastructure/pdf/pdf.module'
import { MonitoringModule } from './infrastructure/monitoring/monitoring.module'
import { DashboardModule } from './api/dashboard/dashboard.module'
import { NotificationsApiModule } from './api/notifications/notifications-api.module'
import { PermissionsModule } from './api/permissions/permissions.module'
import { EsgModule } from './application/esg/esg.module'
import { GiacenzeModule } from './application/giacenze/giacenze.module'
import { AnomalyModule } from './application/anomaly/anomaly.module'
import { ContractModule } from './application/contracts/contract.module'
import { ReferenceDataModule } from './application/reference-data/reference-data.module'
import { RentriModule } from './infrastructure/rentri/rentri.module'
// Amministrazione piattaforma (SUPER_ADMIN): tenant + utenti (provisioning Keycloak)
import { AdminTenantModule } from './application/admin/admin-tenant.module'
import { AdminUserModule } from './application/admin/admin-user.module'
// Endpoint "self" utente autenticato (feature abilitate dal piano)
import { MeModule } from './api/me/me.module'
// Firma digitale FIR "pronta-ma-non-collegata" (WS-E)
// Default: sandbox ECDSA effimera. ATTIVARE: SIGNATURE_PROVIDER=qes + TSA_PROVIDER=rfc3161
import { SignaturesModule } from './application/signatures/signatures.module'
// Registro cronologico carico/scarico (WS-C) — art. 190 D.Lgs 152/2006
import { RegistroModule } from './api/registro/registro.module'

@Module({
  imports: [
    // Environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Event system per eventi di dominio (firma, audit) — global per tutti i moduli
    EventEmitterModule.forRoot({ global: true }),

    // Scheduled tasks (T131)
    ScheduleModule.forRoot(),

    // Security: Rate Limiting (T254)
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
      {
        name: 'long',
        ttl: 900000, // 15 minutes
        limit: 1000, // 1000 requests per 15 minutes
      },
    ]),

    // Infrastructure
    PrismaModule,

    // Authentication & Authorization
    AuthModule,

    // Domain modules
    RegistryModule,
    FIRModule,
    CERModule,

    // Analytics & Reporting
    AnalyticsModule,
    MUDModule,
    EsgModule,
    GiacenzeModule,
    AnomalyModule,
    ContractModule,
    ReferenceDataModule,

    // RENTRI interoperability (client + gestione certificato per-tenant)
    RentriModule,

    // Communication
    NotificationsModule,

    // File Generation
    PDFModule,

    // Operations
    BackupModule,
    MonitoringModule,

    // API Modules
    DashboardModule,
    NotificationsApiModule,

    // IAM / RBAC + ABAC (PermissionGuard opt-in via @RequirePermission)
    PermissionsModule,

    // Amministrazione piattaforma (SUPER_ADMIN)
    AdminTenantModule,
    AdminUserModule,

    // Endpoint "self" utente autenticato
    MeModule,

    // Firma digitale FIR (WS-E) — cablato e raggiungibile; default sandbox
    SignaturesModule,

    // Registro cronologico carico/scarico (WS-C) — art. 190 D.Lgs 152/2006
    RegistroModule,
  ],
  controllers: [HealthController],
  providers: [
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
