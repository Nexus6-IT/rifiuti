/**
 * AdminUserModule
 *
 * Modulo di gestione utenti in-app: espone il controller `admin/users` e il
 * service `UserAdminService` con provisioning su Keycloak.
 *
 * Dipendenze:
 *  - PrismaModule  → accesso al DB (record `User`)
 *  - KeycloakModule → `KeycloakUserAdapter` per il provisioning IdP
 *  - AuthModule    → guard JWT + Roles (JwtAuthGuard, RolesGuard)
 *  - LoggerModule  → logging strutturato (gia' globale, importato per chiarezza)
 *
 * Da registrare in `app.module.ts` (import: [AdminUserModule]).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/persistence/prisma.module';
import { KeycloakModule } from '../../infrastructure/keycloak/keycloak.module';
import { AuthModule } from '../../auth/auth.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { UserAdminService } from './user-admin.service';
import { UserAdminController } from '../../api/admin/user-admin.controller';

@Module({
  imports: [PrismaModule, KeycloakModule, AuthModule, LoggerModule],
  controllers: [UserAdminController],
  providers: [UserAdminService],
  exports: [UserAdminService],
})
export class AdminUserModule {}
