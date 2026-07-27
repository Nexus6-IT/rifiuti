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
import { RentriUnitaLocaleService } from './rentri-unita-locale.service'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriCodificheClient } from './codifiche/rentri-codifiche.client'
import { RentriAnagraficheClient } from './rentri-anagrafiche.client'
import { RentriRateLimiterService } from './rentri-rate-limiter.service'
import { RedisConfig } from '../cache/redis.config'
import { SincronizzaSitiUseCase } from '../../application/rentri/use-cases/sincronizza-siti.use-case'
import { GetRentriDiagnosticaUseCase } from '../../application/rentri/get-rentri-diagnostica.use-case'
import { RentriCredentialController } from '../../api/rentri/rentri-credential.controller'
import { RentriModalitaLegameController } from '../../api/rentri/rentri-modalita-legame.controller'
import { RentriUnitaLocaleController } from '../../api/rentri/rentri-unita-locale.controller'
import { RentriSitiController } from '../../api/rentri/rentri-siti.controller'
import { RentriDiagnosticaController } from '../../api/rentri/rentri-diagnostica.controller'

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
  controllers: [
    RentriCredentialController,
    RentriModalitaLegameController,
    RentriUnitaLocaleController,
    RentriSitiController,
    RentriDiagnosticaController,
  ],
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
    RentriUnitaLocaleService,
    RENTRIApiClient,
    RentriCodificheClient,
    RentriAnagraficheClient,
    SincronizzaSitiUseCase,
    // Terzo strato di resilienza (R5, task 1): rate limiter preventivo
    // per tenant. `RedisConfig` non ha un modulo dedicato che lo esporti
    // (v. `infrastructure/cache/redis.config.ts`) — dipende solo da
    // `ConfigService`, già disponibile qui tramite `ConfigModule` — quindi
    // è dichiarato come provider diretto, come già fa `PermissionsModule`.
    RedisConfig,
    RentriRateLimiterService,
    // Diagnostica di sola lettura (R5 Task 3): NON dipende da RENTRIApiClient
    // (v. commento nell'use case) — deliberatamente, non un'omissione.
    GetRentriDiagnosticaUseCase,
  ],
  exports: [
    RENTRIApiClient,
    RentriCodificheClient,
    RentriAnagraficheClient,
    RentriAuthService,
    RentriSignatureService,
    RentriCredentialService,
    RentriCredentialResolver,
    RentriModalitaLegameService,
    RentriUnitaLocaleService,
    SincronizzaSitiUseCase,
    RentriRateLimiterService,
    RENTRI_CONFIG,
  ],
})
export class RentriModule {}
