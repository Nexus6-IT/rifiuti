import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { LoggerModule } from '../../core/logger/logger.module'
import { MetricsModule } from '../../core/metrics/metrics.module'
import { RENTRI_CONFIG, loadRentriConfig } from './rentri-config'
import { RentriAuthService } from './rentri-auth.service'
import { RentriSignatureService } from './rentri-signature.service'
import { RENTRIApiClient } from './rentri-api.client'

/**
 * RentriModule — sottosistema di interoperabilità RENTRI (client + auth + firma).
 *
 * Pronto a connettersi: in modalità `mock` (default) usa il mock locale; in
 * modalità `live` (`RENTRI_MODE=live`) si collega all'ambiente reale con
 * autenticazione ModI (Bearer + Agid-JWT-Signature). La modalità `live`
 * richiede certificato + chiave privata negli env (vedi `.env.example`).
 */
@Module({
  imports: [ConfigModule, HttpModule, LoggerModule, MetricsModule],
  providers: [
    {
      provide: RENTRI_CONFIG,
      useFactory: (config: ConfigService) => loadRentriConfig(config),
      inject: [ConfigService],
    },
    RentriAuthService,
    RentriSignatureService,
    RENTRIApiClient,
  ],
  exports: [RENTRIApiClient, RentriAuthService, RentriSignatureService, RENTRI_CONFIG],
})
export class RentriModule {}
