/**
 * App Module - Root Module
 * Configures all domain modules and infrastructure
 */

import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { APP_GUARD } from '@nestjs/core'
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

@Module({
  imports: [
    // Environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

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
  ],
  controllers: [HealthController],
  providers: [
    // Apply rate limiting globally (T254)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
