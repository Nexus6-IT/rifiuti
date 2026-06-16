import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/persistence/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { AuthModule } from '../../auth/auth.module';
import { TenantController } from '../../api/admin/tenant.controller';
import { TenantService } from './tenant.service';

/**
 * AdminTenantModule
 *
 * Gestione anagrafica dei tenant riservata al SUPER_ADMIN.
 *
 * Importa:
 * - PrismaModule  → PrismaService (accesso DB; il modello Tenant non è RLS-scoped).
 * - AuthModule    → JwtAuthGuard + RolesGuard usati dal controller.
 * - LoggerModule  → LoggerService (è @Global, importato qui per esplicitezza).
 *
 * Da registrare in `app.module.ts` (a cura del coordinatore):
 *   import { AdminTenantModule } from './application/admin/admin-tenant.module';
 *   imports: [ ..., AdminTenantModule ]
 */
@Module({
  imports: [PrismaModule, AuthModule, LoggerModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class AdminTenantModule {}
