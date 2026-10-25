import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { MeModule } from '../../api/me/me.module'
import { TenantController } from '../../api/admin/tenant.controller'
import { TenantService } from './tenant.service'
import { AuditPiattaformaController } from '../../api/admin/audit-piattaforma.controller'
import { AuditPiattaformaService } from './audit-piattaforma.service'

/**
 * AdminTenantModule
 *
 * Gestione anagrafica dei tenant riservata al SUPER_ADMIN.
 *
 * Importa:
 * - PrismaModule  → PrismaService (accesso DB; il modello Tenant non è RLS-scoped).
 * - AuthModule    → JwtAuthGuard + RolesGuard usati dal controller.
 * - LoggerModule  → LoggerService (è @Global, importato qui per esplicitezza).
 * - MeModule      → MembershipService.checkAccess, usato da TenantService.create per
 *   verificare che un ADMIN abbia titolo sulla madre indicata in `parentTenantId`
 *   prima di agganciarci una figlia (nessun ciclo: MeModule non dipende da questo
 *   modulo, solo da PrismaModule/AuthModule/BillingModule).
 *
 * Da registrare in `app.module.ts` (a cura del coordinatore):
 *   import { AdminTenantModule } from './application/admin/admin-tenant.module';
 *   imports: [ ..., AdminTenantModule ]
 */
@Module({
  imports: [PrismaModule, AuthModule, LoggerModule, MeModule],
  controllers: [TenantController, AuditPiattaformaController],
  providers: [TenantService, AuditPiattaformaService],
  exports: [TenantService],
})
export class AdminTenantModule {}
