import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { RentriSyncModule } from './rentri-sync.module'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { TriggerBatchSyncUseCase } from './trigger-batch-sync.use-case'
import { GetSyncStatusUseCase } from './get-sync-status.use-case'
import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'
import { ConfermaLegameRENTRIUseCase } from './conferma-legame-rentri.use-case'
import { CercaFormulariRENTRIUseCase } from './cerca-formulari-rentri.use-case'
import { AcquisisciFormularioRENTRIUseCase } from './acquisisci-formulario-rentri.use-case'
import { RilasciaFormularioRENTRIUseCase } from './rilascia-formulario-rentri.use-case'
import { CREA_FIR_DA_FORMULARIO_RENTRI_PORT } from './crea-fir-da-formulario-rentri.port'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import { AccettaORespingiFIRUseCase } from './accetta-o-respingi-fir.use-case'
import { AnnullaFIRRentriUseCase } from './annulla-fir-rentri.use-case'
import { GestisciAllegatiFIRUseCase } from './gestisci-allegati-fir.use-case'
import { ScaricaPdfFirUseCase } from './scarica-pdf-fir.use-case'
import { RiconciliaStatoRentriUseCase } from './riconcilia-stato-rentri.use-case'
import { RentriRiconciliazioneJob } from '../../infrastructure/jobs/rentri-riconciliazione.job'
import { RentriCertificatoScadenzaJob } from '../../infrastructure/jobs/rentri-certificato-scadenza.job'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { RENTRISyncJobProcessor } from '../../infrastructure/queue/jobs/rentri-sync.job'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { RENTRISyncController } from '../../api/rentri/rentri-sync.controller'
import { RentriFormulariController } from '../../api/rentri/rentri-formulari.controller'
import { RentriFirLifecycleController } from '../../api/rentri/rentri-fir-lifecycle.controller'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { RentriScortaRepository } from '../../infrastructure/persistence/rentri-scorta.repository'
import { ElencaBlocchiRentriUseCase } from './scorta/elenca-blocchi-rentri.use-case'
import { GetScortaRentriUseCase } from './scorta/get-scorta-rentri.use-case'
import { AvviaVidimazioneScortaUseCase } from './scorta/avvia-vidimazione-scorta.use-case'
import { ImpostaBloccoPredefinitoUseCase } from './scorta/imposta-blocco-predefinito.use-case'
import { VerificaEmissionePossibileRentriUseCase } from './scorta/verifica-emissione-possibile.use-case'
import { ConsumaNumeroVidimatoUseCase } from './scorta/consuma-numero-vidimato.use-case'
import { RentriRifornimentoScortaJob } from '../../infrastructure/jobs/rentri-rifornimento-scorta.job'
import { RentriTrasmissioniSospeseJob } from '../../infrastructure/jobs/rentri-trasmissioni-sospese.job'
import { RentriScortaController } from '../../api/rentri/rentri-scorta.controller'
import { AppModule } from '../../app.module'

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

    // R2 Task 4: cercare/acquisire/rilasciare un formulario esistente.
    expect(moduleRef.get(CercaFormulariRENTRIUseCase)).toBeDefined()
    expect(moduleRef.get(AcquisisciFormularioRENTRIUseCase)).toBeDefined()
    expect(moduleRef.get(RilasciaFormularioRENTRIUseCase)).toBeDefined()
    // Il token della porta verso il Task 5 (non ancora implementato) deve
    // comunque risolversi, con l'adapter placeholder — altrimenti
    // AcquisisciFormularioRENTRIUseCase stesso non si costruirebbe.
    expect(moduleRef.get(CREA_FIR_DA_FORMULARIO_RENTRI_PORT)).toBeDefined()

    // R2 Task 6: il controller REST dell'aggancio deve risolversi (stesso
    // errore già commesso una volta con RENTRISyncController, v. sopra — un
    // provider/controller dichiarato ma mai importato da AppModule non
    // basta).
    expect(moduleRef.get(RentriFormulariController)).toBeDefined()

    // R3 Task 2: il motore della UI (azioni RENTRI disponibili) — stesso
    // errore da non ripetere, il controller deve risolversi davvero, non
    // solo l'use case.
    expect(moduleRef.get(GetAzioniDisponibiliUseCase)).toBeDefined()
    expect(moduleRef.get(RentriFirLifecycleController)).toBeDefined()

    // R3 Task 4: accettazione/respingimento del carico — stesso motivo,
    // deve risolversi anche il controller che lo espone (già verificato
    // sopra), non solo lo use case in isolamento.
    expect(moduleRef.get(AccettaORespingiFIRUseCase)).toBeDefined()

    // R3 Task 5: annullamento del formulario, con nota — stesso motivo,
    // stesso errore ricorrente da non ripetere: deve risolversi anche qui,
    // non restare orfano (v. `AccettaORespingiFIRUseCase` sopra).
    expect(moduleRef.get(AnnullaFIRRentriUseCase)).toBeDefined()

    // R3 Task 6: allegati del formulario — stesso motivo, stesso errore
    // ricorrente da non ripetere: deve risolversi anche qui (il controller
    // che lo espone è lo stesso RentriFirLifecycleController già verificato
    // sopra, con GestisciAllegatiFIRUseCase iniettato in più).
    expect(moduleRef.get(GestisciAllegatiFIRUseCase)).toBeDefined()

    // R3 Task 7: stampa PDF — stesso motivo, stesso errore ricorrente da non
    // ripetere: deve risolversi anche qui (stesso controller di sopra, con
    // ScaricaPdfFirUseCase iniettato in più).
    expect(moduleRef.get(ScaricaPdfFirUseCase)).toBeDefined()

    // R5 Task 4/5: riconciliazione periodica + i due job schedulati che ne
    // dipendono/l'accompagnano (allarmi Prometheus).
    expect(moduleRef.get(RiconciliaStatoRentriUseCase)).toBeDefined()
    expect(moduleRef.get(RentriRiconciliazioneJob)).toBeDefined()
    expect(moduleRef.get(RentriCertificatoScadenzaJob)).toBeDefined()

    // R6 — scorta di numeri FIR pre-vidimati: stesso motivo, stesso errore
    // ricorrente da non ripetere (v. `RentriVidimazioneClient`, corretto e
    // provato ma mai cablato prima d'ora). Deve risolversi anche il
    // controller REST, non solo i singoli use case in isolamento.
    expect(moduleRef.get(RentriScortaRepository)).toBeDefined()
    expect(moduleRef.get(ElencaBlocchiRentriUseCase)).toBeDefined()
    expect(moduleRef.get(GetScortaRentriUseCase)).toBeDefined()
    expect(moduleRef.get(AvviaVidimazioneScortaUseCase)).toBeDefined()
    expect(moduleRef.get(ImpostaBloccoPredefinitoUseCase)).toBeDefined()
    expect(moduleRef.get(VerificaEmissionePossibileRentriUseCase)).toBeDefined()
    expect(moduleRef.get(ConsumaNumeroVidimatoUseCase)).toBeDefined()
    expect(moduleRef.get(RentriRifornimentoScortaJob)).toBeDefined()
    expect(moduleRef.get(RentriTrasmissioniSospeseJob)).toBeDefined()
    expect(moduleRef.get(RentriScortaController)).toBeDefined()

    // Nessun moduleRef.close(): onModuleInit non è mai stato invocato
    // (niente connessioni reali aperte), quindi non c'è nulla da chiudere.
  })

  /**
   * R0 Task 4 aveva scoperto otto pezzi cablati in DI ma MAI importati da
   * `AppModule` (dichiarare un provider in questo modulo non basta: se
   * `RentriSyncModule` stesso non è nell'array `imports` di `AppModule`,
   * l'intero sottosistema resta irraggiungibile a runtime). Questo test
   * verifica la METADATA del decoratore `@Module` di `AppModule` (via
   * `Reflect`, nessuna istanza creata, nessuna connessione aperta) invece di
   * fidarsi di una lettura a occhio del sorgente — non ripete l'errore.
   */
  it('RentriSyncModule è importato da AppModule (non basta dichiararlo)', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[]

    expect(imports).toBeDefined()
    expect(imports).toContain(RentriSyncModule)
  })
})
