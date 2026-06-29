/**
 * SignupModule — registrazione self-service aziende (WS-G).
 *
 * Espone il controller pubblico POST /auth/signup che crea un tenant TRIAL
 * e il suo utente ADMIN con provisioning su Keycloak.
 *
 * Dipendenze:
 *  - PrismaModule    → accesso DB (Tenant + User in transazione)
 *  - KeycloakModule  → KeycloakUserAdapter (createUser, deleteUser, sendVerifyEmail)
 *  - LoggerModule    → logging strutturato (già globale, importato per chiarezza)
 *
 * Registrare in app.module.ts:
 *   import { SignupModule } from './application/signup/signup.module';
 *   imports: [ ..., SignupModule ]
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/persistence/prisma.module';
import { KeycloakModule } from '../../infrastructure/keycloak/keycloak.module';
import { LoggerModule } from '../../core/logger/logger.module';
import { SignupService } from './signup.service';
import { SignupController } from '../../api/signup/signup.controller';

@Module({
  imports: [PrismaModule, KeycloakModule, LoggerModule],
  controllers: [SignupController],
  providers: [SignupService],
  exports: [SignupService],
})
export class SignupModule {}
