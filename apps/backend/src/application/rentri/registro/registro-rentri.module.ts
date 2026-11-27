import { Module } from '@nestjs/common'
import { LoggerModule } from '../../../core/logger/logger.module'
import { MetricsModule } from '../../../core/metrics/metrics.module'
import { PrismaModule } from '../../../infrastructure/persistence/prisma.module'
import { RentriModule } from '../../../infrastructure/rentri/rentri.module'
import { ModuliAttiviModule } from '../../admin/moduli-attivi.module'
import { AuthModule } from '../../../auth/auth.module'
import { RuoloEffettivoModule } from '../../../api/me/ruolo-effettivo.module'
import { RentriRegistroController } from '../../../api/rentri/rentri-registro.controller'
import { RentriRegistroCollegamentoController } from '../../../api/rentri/rentri-registro-collegamento.controller'
import { RentriRegistroEsportazioniController } from '../../../api/rentri/rentri-registro-esportazioni.controller'
import { DettaglioTrasmissioneRentriService } from './dettaglio-trasmissione-rentri.service'
import { RentriRegistroTrasmissioneJob } from '../../../infrastructure/jobs/rentri-registro-trasmissione.job'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'
import { TrasmettiLottoRegistroUseCase } from './trasmetti-lotto-registro.use-case'
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'
import { VerificaTrasmissioneRentriUseCase } from './verifica-trasmissione-rentri.use-case'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'
import { CandidatiRegistroRentriUseCase } from './candidati-registro-rentri.use-case'
import { CollegaRegistroRentriUseCase } from './collega-registro-rentri.use-case'
import { ApriRegistroRentriUseCase } from './apri-registro-rentri.use-case'
import { ModificaRegistroRentriUseCase } from './modifica-registro-rentri.use-case'
import { ChiudiRegistroRentriUseCase } from './chiudi-registro-rentri.use-case'
import { AbbandonaAperturaRegistroRentriUseCase } from './abbandona-apertura-registro-rentri.use-case'
import { GeneraEsportazioneRegistroRentriUseCase } from './genera-esportazione-registro-rentri.use-case'
import { ValidaEsportazioneRegistroRentriUseCase } from './valida-esportazione-registro-rentri.use-case'
import { SostituisciEsportazioneRegistroRentriUseCase } from './sostituisci-esportazione-registro-rentri.use-case'
import { EsportazioniRegistroRentriService } from './esportazioni-registro-rentri.service'

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
    // Il job filtra le aziende col modulo `rentri`
    ModuliAttiviModule,
  ],
  controllers: [
    RentriRegistroController,
    RentriRegistroCollegamentoController,
    RentriRegistroEsportazioniController,
  ],
  providers: [
    DettaglioTrasmissioneRentriService,
    LettoreAnnotazioniRentri,
    TrasmissioniRegistroRepository,
    TrasmettiLottoRegistroUseCase,
    AccodaTrasmissioneRentriUseCase,
    VerificaTrasmissioneRentriUseCase,
    ImpostazioniRentriRegistroService,
    CandidatiRegistroRentriUseCase,
    CollegaRegistroRentriUseCase,
    ApriRegistroRentriUseCase,
    ModificaRegistroRentriUseCase,
    ChiudiRegistroRentriUseCase,
    AbbandonaAperturaRegistroRentriUseCase,
    GeneraEsportazioneRegistroRentriUseCase,
    ValidaEsportazioneRegistroRentriUseCase,
    SostituisciEsportazioneRegistroRentriUseCase,
    EsportazioniRegistroRentriService,
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
