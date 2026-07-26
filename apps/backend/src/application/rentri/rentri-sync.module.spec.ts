import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { RentriSyncModule } from './rentri-sync.module'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { TriggerBatchSyncUseCase } from './trigger-batch-sync.use-case'
import { GetSyncStatusUseCase } from './get-sync-status.use-case'
import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'
import { ConfermaLegameRENTRIUseCase } from './conferma-legame-rentri.use-case'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { RENTRISyncJobProcessor } from '../../infrastructure/queue/jobs/rentri-sync.job'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { RENTRISyncController } from '../../api/rentri/rentri-sync.controller'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'

/**
 * DI smoke test per RentriSyncModule (R0 Task 4).
 *
 * Verifica che gli otto pezzi prima orfani si compongano in un unico modulo
 * risolvibile da Nest — senza aprire connessioni reali.
 *
 * ATTENZIONE (avvertenza esplicita nel task): `RENTRISyncQueue` e
 * `RENTRISyncJobProcessor` aprono connessioni Redis reali (BullMQ `Queue`/
 * `Worker` istanziati "a mano"), ma SOLO dentro `onModuleInit`/`onModuleDestroy`.
 * `Test.createTestingModule(...).compile()` risolve l'intero grafo DI (crea le
 * istanze via `new`, chiama i costruttori) MA non invoca gli hook del ciclo di
 * vita Nest (`onModuleInit`/`onApplicationBootstrap`) finché non si chiama
 * esplicitamente `moduleRef.init()`. Qui NON si chiama `.init()` e non si
 * chiama nemmeno `.close()` (che for a `onModuleDestroy`, gestito solo se
 * `.init()` è stato chiamato prima — stesso accorgimento già documentato in
 * `permissions.module.spec.ts`): il test verifica solo che il grafo DI sia
 * valido, non il comportamento a runtime della coda/worker. Questo è
 * esattamente il modo per evitare il blocco a tempo indefinito già avvenuto
 * in questo progetto con un `Test.createTestingModule` ingenuo su un modulo
 * che tocca Redis/Bull.
 */
describe('RentriSyncModule (DI wiring)', () => {
  it('risolve gli otto pezzi applicativi/infrastrutturali e il controller (R0 Task 4 + R1 Task 2)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RentriSyncModule],
    }).compile()

    expect(moduleRef.get(SyncFIRToRENTRIUseCase)).toBeDefined()
    expect(moduleRef.get(TriggerBatchSyncUseCase)).toBeDefined()
    expect(moduleRef.get(GetSyncStatusUseCase)).toBeDefined()
    expect(moduleRef.get(RENTRISyncQueue)).toBeDefined()
    expect(moduleRef.get(RENTRISyncJobProcessor)).toBeDefined()
    expect(moduleRef.get(RENTRISyncLogRepository)).toBeDefined()
    expect(moduleRef.get(TrasmettiFIRSecondoModalitaUseCase)).toBeDefined()
    expect(moduleRef.get(ConfermaLegameRENTRIUseCase)).toBeDefined()
    expect(moduleRef.get(RENTRISyncController)).toBeDefined()

    // RENTRIApiClient viene da RentriModule (importato): conferma che
    // l'iniezione cross-modulo funziona davvero, non solo che ogni pezzo si
    // risolva in isolamento.
    expect(moduleRef.get(RENTRIApiClient)).toBeDefined()

    // Nessun moduleRef.close(): onModuleInit non è mai stato invocato
    // (niente connessioni reali aperte), quindi non c'è nulla da chiudere.
  })
})
