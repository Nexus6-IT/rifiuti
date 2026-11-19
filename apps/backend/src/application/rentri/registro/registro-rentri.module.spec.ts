import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { RegistroRentriModule } from './registro-rentri.module'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'
import { TrasmettiLottoRegistroUseCase } from './trasmetti-lotto-registro.use-case'
import { AccodaTrasmissioneRentriUseCase } from './accoda-trasmissione-rentri.use-case'
import { VerificaTrasmissioneRentriUseCase } from './verifica-trasmissione-rentri.use-case'
import { ImpostazioniRentriRegistroService } from './impostazioni-rentri-registro.service'
import { RentriRegistroController } from '../../../api/rentri/rentri-registro.controller'
import { RentriRegistroCollegamentoController } from '../../../api/rentri/rentri-registro-collegamento.controller'
import { CandidatiRegistroRentriUseCase } from './candidati-registro-rentri.use-case'
import { CollegaRegistroRentriUseCase } from './collega-registro-rentri.use-case'
import { ApriRegistroRentriUseCase } from './apri-registro-rentri.use-case'
import { DettaglioTrasmissioneRentriService } from './dettaglio-trasmissione-rentri.service'
import { RentriRegistroTrasmissioneJob } from '../../../infrastructure/jobs/rentri-registro-trasmissione.job'

/**
 * DI smoke test: i provider reali (nessun override) si risolvono. Senza `.init()`, quindi senza
 * connessioni ne' scheduler avviati.
 */
describe('RegistroRentriModule (DI wiring)', () => {
  it('risolve repository, lettore, use case, servizio impostazioni e job', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RegistroRentriModule,
      ],
    }).compile()

    for (const token of [
      LettoreAnnotazioniRentri,
      TrasmissioniRegistroRepository,
      TrasmettiLottoRegistroUseCase,
      AccodaTrasmissioneRentriUseCase,
      VerificaTrasmissioneRentriUseCase,
      ImpostazioniRentriRegistroService,
      RentriRegistroTrasmissioneJob,
      RentriRegistroController,
      DettaglioTrasmissioneRentriService,
      CandidatiRegistroRentriUseCase,
      CollegaRegistroRentriUseCase,
      ApriRegistroRentriUseCase,
      RentriRegistroCollegamentoController,
    ]) {
      expect(moduleRef.get(token, { strict: false })).toBeDefined()
    }
  })
})
