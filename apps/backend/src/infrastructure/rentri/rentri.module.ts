import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { LoggerModule } from '../../core/logger/logger.module'
import { MetricsModule } from '../../core/metrics/metrics.module'
import { PrismaModule } from '../persistence/prisma.module'
import { RENTRI_CONFIG, loadRentriConfig } from './rentri-config'
import { RentriCredentialService } from './rentri-credential.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriAuthService } from './rentri-auth.service'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriModalitaLegameService } from './rentri-modalita-legame.service'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriCodificheClient } from './codifiche/rentri-codifiche.client'
import { RentriCredentialController } from '../../api/rentri/rentri-credential.controller'
import { RentriModalitaLegameController } from '../../api/rentri/rentri-modalita-legame.controller'

/**
 * RentriModule — sottosistema di interoperabilità RENTRI (client + auth + firma).
 *
 * Pronto a connettersi: si collega all'ambiente reale RENTRI (demo/prod) con
 * autenticazione ModI (Bearer self-issued + Agid-JWT-Signature). Richiede
 * certificato + chiave privata negli env (vedi `.env.example`); senza,
 * l'handshake reale non può avvenire (il codice resta comunque completo).
 * Nei test automatici l'ambiente reale è sostituito dalla fake fedele al
 * contratto in `tools/rentri-fake` (v. `docs/audits/rentri-conformita-2026-07-25/README.md`).
 */
@Module({
  imports: [ConfigModule, HttpModule, LoggerModule, MetricsModule, PrismaModule],
  controllers: [RentriCredentialController, RentriModalitaLegameController],
  providers: [
    {
      provide: RENTRI_CONFIG,
      useFactory: (config: ConfigService) => loadRentriConfig(config),
      inject: [ConfigService],
    },
    RentriCredentialService,
    RentriCredentialResolver,
    RentriAuthService,
    RentriSignatureService,
    RentriModalitaLegameService,
    RENTRIApiClient,
    RentriCodificheClient,
  ],
  exports: [
    RENTRIApiClient,
    RentriCodificheClient,
    RentriAuthService,
    RentriSignatureService,
    RentriCredentialService,
    RentriCredentialResolver,
    RentriModalitaLegameService,
    RENTRI_CONFIG,
  ],
})
export class RentriModule {}
