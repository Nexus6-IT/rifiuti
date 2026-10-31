import { Module } from '@nestjs/common'
import { LoggerModule } from '../../../core/logger/logger.module'
import { MetricsModule } from '../../../core/metrics/metrics.module'
import { PrismaModule } from '../../../infrastructure/persistence/prisma.module'
import { RentriModule } from '../../../infrastructure/rentri/rentri.module'
import { AuthModule } from '../../../auth/auth.module'
import { RuoloEffettivoModule } from '../../../api/me/ruolo-effettivo.module'
import { RentriRegistroController } from '../../../api/rentri/rentri-registro.controller'
import { DettaglioTrasmissioneRentriService } from './dettaglio-trasmissione-rentri.service'
import { RentriRegistroTrasmissioneJob } from '../../../infrastructure/jobs/rentri-registro-trasmissione.job'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'
import { TrasmettiLottoRegistroUseCase } from './trasmetti-lotto-registro.use-case'
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'
import { VerificaTrasmissioneRentriUseCase } from './verifica-trasmissione-rentri.use-case'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'

/**
 * Trasmissione a RENTRI del registro di carico/scarico (F2-9).
 *
 * Il job e' solo provider (nessun export): cosi' il suo `@Cron` non si registra due volte.
 * Esporta gli use case che useranno i controller e le fasi successive. `AuthModule` e `RuoloEffettivoModule`
 * servono a `RentriModule` (guard) e al controller.
 */
@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    MetricsModule,
    RentriModule,
    AuthModule,
    RuoloEffettivoModule,
  ],
  controllers: [RentriRegistroController],
  providers: [
    DettaglioTrasmissioneRentriService,
    LettoreAnnotazioniRentri,
    TrasmissioniRegistroRepository,
    TrasmettiLottoRegistroUseCase,
    AccodaTrasmissioneRentriUseCase,
    VerificaTrasmissioneRentriUseCase,
    ImpostazioniRentriRegistroService,
    RentriRegistroTrasmissioneJob,
  ],
  exports: [
    AccodaTrasmissioneRentriUseCase,
    TrasmettiLottoRegistroUseCase,
    VerificaTrasmissioneRentriUseCase,
    ImpostazioniRentriRegistroService,
  ],
})
export class RegistroRentriModule {}
