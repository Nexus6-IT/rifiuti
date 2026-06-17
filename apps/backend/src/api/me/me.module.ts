import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/persistence/prisma.module';
import { AuthModule } from '../../auth/auth.module';
import { MeFeaturesController } from './me-features.controller';
import { MeFeaturesService } from './me-features.service';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';

/**
 * MeModule
 *
 * Endpoint "self" per l'utente autenticato (es. feature abilitate dal piano).
 *
 * Dipendenze:
 *  - PrismaModule → lettura tenant (tier/limiti/featureFlags).
 *  - AuthModule   → JwtAuthGuard (autenticazione).
 *
 * Da registrare in `app.module.ts`:
 *   import { MeModule } from './api/me/me.module';
 *   imports: [ ..., MeModule ]
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MeFeaturesController, MembershipController],
  providers: [MeFeaturesService, MembershipService],
})
export class MeModule {}
