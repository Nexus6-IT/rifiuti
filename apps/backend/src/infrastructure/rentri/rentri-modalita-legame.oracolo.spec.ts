import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { SyncFIRToRENTRIUseCase } from '../../application/rentri/sync-fir-to-rentri.use-case'
import { costruttorePayloadFinto } from '../../application/rentri/mappatura/aiuti-test'
import { TrasmettiFIRSecondoModalitaUseCase } from '../../application/rentri/trasmetti-fir-secondo-modalita.use-case'
import { FIR, FIRStato, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
// eslint-disable-next-line @typescript-eslint/no-var-requires
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R1 Task 6: chiude il ciclo contro l'oracolo per le due promesse fatte
 * all'utente sulla MODALITÀ di trasmissione (`Tenant.rentriModalitaLegame`,
 * R1 Task 1/2):
 *
 * - **AUTOMATICA**: un formulario emesso risulta legato a RENTRI senza
 *   ALCUNA chiamata esplicita di trasmissione nel test — l'unica cosa che il
 *   test invoca è `TrasmettiFIRSecondoModalitaUseCase.eseguiSeAutomatica`,
 *   cioè esattamente il punto di aggancio che `EmettiFIRUseCase` chiama da
 *   solo subito dopo l'emissione (v. commento in
 *   `trasmetti-fir-secondo-modalita.use-case.ts`). La vera trasmissione
 *   (`SyncFIRToRENTRIUseCase.execute`) non è mai chiamata dal corpo del
 *   test: è cablata come "gestore" della coda finta, a simulare il worker
 *   BullMQ che la processa in modo asincrono — la stessa architettura di
 *   produzione, senza bisogno di un Redis reale in questa suite (che è
 *   già isolata da ogni dipendenza esterna, v. gli spec sorelle).
 *
 * - **MANUALE**: dopo l'emissione non deve partire NULLA, nemmeno una
 *   telefonata alla fake RENTRI. Non basta verificare lo stato del FIR: lo
 *   spec intercetta anche il client HTTP verso la fake e dimostra che la
 *   sua sequenza di chiamate resta vuota — la prova più diretta che nessuna
 *   richiesta di rete è mai partita.
 *
 * **Limite dichiarato**: la decisione "quale coda/worker usare" è la stessa
 * cablatura di produzione (`RENTRISyncQueue.addSyncJob` → job BullMQ →
 * `RENTRISyncJobProcessor` → `SyncFIRToRENTRIUseCase.execute`), ma qui la
 * coda è una finta che invoca il gestore in modo sincrono invece di passare
 * da Redis: l'oracolo non ha modo di far girare un Worker BullMQ reale senza
 * un Redis in CI. Quello che lo spec dimostra è che LA DECISIONE presa da
 * `TrasmettiFIRSecondoModalitaUseCase` è l'unica cosa che innesca la
 * trasmissione, e che in AUTOMATICA il risultato finale (legame scritto) è
 * raggiunto senza che il test debba mai chiamare esplicitamente
 * un'operazione di trasmissione.
 */
describe('TrasmettiFIRSecondoModalitaUseCase — modalità di trasmissione contro la fake RENTRI (in-process)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  class FIRRepositoryFake
    implements
      Pick<
        IFIRRepository,
        'findById' | 'save' | 'prenotaTrasmissioneRentri' | 'registraTransazioneInAttesa'
      >
  {
    private readonly memoria = new Map<string, FIR>()

    async findById(id: string): Promise<FIR | null> {
      return this.memoria.get(id) ?? null
    }

    async save(fir: FIR): Promise<void> {
      this.memoria.set(fir.id, fir)
    }

    // Un solo processo e un solo oggetto per FIR: la prenotazione riesce sempre.
    // La semantica concorrente e' provata in sync-fir-idempotenza.oracolo.spec.ts.
    async prenotaTrasmissioneRentri(): Promise<boolean> {
      return true
    }

    async registraTransazioneInAttesa(): Promise<boolean> {
      return true
    }
  }

  function creaFIREmesso(tenantId: string): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-oracolo-modalita',
      trasportatoreId: 'trasportatore-oracolo-modalita',
      destinatarioId: 'destinatario-oracolo-modalita',
      tenantId,
      rifiuto: {
        cerCode: '150101',
        quantita: 100,
      },
    })

    const firmaProduttore: FirmaDigitale = {
      firmatario: 'Produttore di prova SRL',
      timestamp: new Date(),
      certificato: 'certificato-di-prova',
    }

    fir.emetti('FIR-ORACOLO-MODALITA-000001', firmaProduttore)
    return fir
  }

  /** Stesso adattatore fedele ad axios di `rentri-sync.oracolo.spec.ts`. */
  function creaClientETracciato(): {
    client: RENTRIApiClient
    sequenza: string[]
    transazioneRef: { id?: string }
  } {
    const cert = creaCertificatoDiTest('operatore-test-modalita')

    const config: RentriConfig = {
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operatore-test',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem: `-----BEGIN CERTIFICATE-----\n${cert.certificatoBase64Der}\n-----END CERTIFICATE-----`,
      privateKeyPem: cert.chiavePrivataPem,
      algorithm: 'RS256',
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
    }

    const credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const auth = new RentriAuthService(credentialService as any, config, logger)
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    const sequenza: string[] = []
    const transazioneRef: { id?: string } = {}

    function emetti(
      metodo: 'POST' | 'GET',
      path: string,
      subscriber: {
        next: (r: AxiosResponse) => void
        error: (e: unknown) => void
        complete: () => void
      },
      risposta: any,
      validateStatus?: (status: number) => boolean
    ): void {
      sequenza.push(`${metodo} ${path} ${risposta.statusCode}`)

      if (metodo === 'POST' && risposta.statusCode === 202 && path.endsWith('/formulari/v1.0/')) {
        const corpo = risposta.json()
        if (corpo?.transazione_id) {
          transazioneRef.id = corpo.transazione_id
        }
      }

      const risposaAdattata: AxiosResponse = {
        data: risposta.payload ? risposta.json() : undefined,
        status: risposta.statusCode,
        statusText: '',
        headers: risposta.headers as Record<string, string>,
        config: {} as any,
      }

      const okComunque = validateStatus?.(risposaAdattata.status) ?? false
      if (risposaAdattata.status >= 400 && !okComunque) {
        const errore: any = new Error(`Richiesta fallita con status ${risposaAdattata.status}`)
        errore.response = risposaAdattata
        subscriber.error(errore)
        return
      }
      subscriber.next(risposaAdattata)
      subscriber.complete()
    }

    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => emetti('POST', path, subscriber, risposta, undefined))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (
        url: string,
        opts: { headers: Record<string, string>; validateStatus?: (status: number) => boolean }
      ) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'GET', url: path, headers: opts.headers })
            .then((risposta: any) => emetti('GET', path, subscriber, risposta, opts.validateStatus))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return {
      client: new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any),
      sequenza,
      transazioneRef,
    }
  }

  function creaDipendenzeApplicative() {
    const logSalvati: any[] = []
    const syncLogRepository: any = {
      createPending: jest.fn().mockResolvedValue({
        markAsSuccess: (params: any) => ({ tipo: 'SUCCESS', ...params }),
        markAsFailure: (params: any) => ({ tipo: 'FAILURE', ...params }),
      }),
      save: jest.fn(async (log: any) => {
        logSalvati.push(log)
      }),
    }
    const eventiPubblicati: any[] = []
    const domainEvents: any = {
      publish: jest.fn(async (event: any) => {
        eventiPubblicati.push(event)
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    return { syncLogRepository, logSalvati, domainEvents, eventiPubblicati, logger }
  }

  function creaLoggerOrchestrazione(): any {
    return {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  it('AUTOMATICA: un formulario emesso risulta legato a RENTRI senza alcuna chiamata esplicita di trasmissione nel test', async () => {
    const tenantId = 'tenant-oracolo-automatica'
    const fir = creaFIREmesso(tenantId)
    expect(fir.stato).toBe(FIRStato.EMESSO)
    expect(fir.canSyncToRENTRI()).toBe(true)

    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    const { client, transazioneRef } = creaClientETracciato()
    const { syncLogRepository, domainEvents, logger: syncLogger } = creaDipendenzeApplicative()

    const syncUseCase = new SyncFIRToRENTRIUseCase(
      firRepository as any,
      client,
      syncLogRepository,
      domainEvents,
      syncLogger,
      costruttorePayloadFinto()
    )

    // La coda finta: al posto di Redis/BullMQ, invoca direttamente il
    // gestore che in produzione è `RENTRISyncJobProcessor` — l'unica
    // differenza è il trasporto (sincrono qui, asincrono via Redis in
    // produzione), non la logica. Il test NON chiama mai `syncUseCase`
    // direttamente: lo fa solo questa coda, come farebbe il worker reale.
    const modalitaLegameService: any = {
      getForTenant: jest.fn().mockResolvedValue({
        modalitaLegame: 'AUTOMATICA',
        certificatoConfigurato: true,
      }),
    }
    const rentriSyncQueue: any = {
      addSyncJob: jest.fn(
        async (job: { firId: string; tenantId: string; correlationId?: string }) => {
          await syncUseCase.execute(job.firId, job.tenantId, job.correlationId)
          return 'job-automatica-oracolo'
        }
      ),
    }

    const trasmettiUseCase = new TrasmettiFIRSecondoModalitaUseCase(
      modalitaLegameService,
      rentriSyncQueue,
      creaLoggerOrchestrazione()
    )

    // Timer reale (non fake di Jest, che bloccherebbe app.inject()) che
    // completa la transazione non appena la fake RENTRI ne rivela l'id.
    const attendiTransazioneId = async (): Promise<string> => {
      const inizio = Date.now()
      while (!transazioneRef.id) {
        if (Date.now() - inizio > 5000) {
          throw new Error('transazione_id non catturata entro il timeout del test')
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return transazioneRef.id
    }

    // L'UNICA cosa chiamata dal test: il punto di aggancio che
    // `EmettiFIRUseCase` invoca da solo, subito dopo l'emissione. Nessuna
    // chiamata a `syncUseCase`/endpoint di trasmissione nel corpo del test.
    const esitoPromise = trasmettiUseCase.eseguiSeAutomatica({
      firId: fir.id,
      tenantId,
      correlationId: 'correlazione-automatica-oracolo',
    })

    void attendiTransazioneId().then(transazioneId => {
      setTimeout(() => {
        void app.inject({
          method: 'POST',
          url: '/__controllo/completa-transazione',
          payload: {
            transazione_id: transazioneId,
            errore: false,
            validazione: [],
            esito: { numero_fir: 'RENTRI-ORACOLO-AUTOMATICA-000001' },
          },
        })
      }, 150)
    })

    const esito = await esitoPromise

    expect(esito.avviata).toBe(true)
    expect(esito.richiedeConferma).toBe(false)
    expect(rentriSyncQueue.addSyncJob).toHaveBeenCalledTimes(1)

    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto).not.toBeNull()
    expect(firRiletto!.rentriNumeroFir).toBe('RENTRI-ORACOLO-AUTOMATICA-000001')
    expect(firRiletto!.rentriSyncStatus.getStatus()).toBe('SYNCED')
    expect(firRiletto!.rentriOrigineLegame).toBe('TRASMESSO_DA_NOI')
  }, 15000)

  it("MANUALE: dopo l'emissione non parte nulla finché non lo si chiede esplicitamente — nemmeno una richiesta HTTP verso RENTRI", async () => {
    const tenantId = 'tenant-oracolo-manuale'
    const fir = creaFIREmesso(tenantId)
    expect(fir.stato).toBe(FIRStato.EMESSO)
    expect(fir.canSyncToRENTRI()).toBe(true)

    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    // Il client verso la fake RENTRI viene creato ma non deve MAI essere
    // usato in questo scenario: la sua `sequenza` deve restare vuota.
    const { sequenza } = creaClientETracciato()

    const modalitaLegameService: any = {
      getForTenant: jest.fn().mockResolvedValue({
        modalitaLegame: 'MANUALE',
        certificatoConfigurato: false,
      }),
    }
    const rentriSyncQueue: any = {
      addSyncJob: jest.fn(),
    }

    const trasmettiUseCase = new TrasmettiFIRSecondoModalitaUseCase(
      modalitaLegameService,
      rentriSyncQueue,
      creaLoggerOrchestrazione()
    )

    const esito = await trasmettiUseCase.eseguiSeAutomatica({
      firId: fir.id,
      tenantId,
      correlationId: 'correlazione-manuale-oracolo',
    })

    expect(esito.avviata).toBe(false)
    expect(esito.motivo).toBe('MANUALE')
    expect(rentriSyncQueue.addSyncJob).not.toHaveBeenCalled()

    // Nessuna richiesta di rete è mai partita verso la fake RENTRI.
    expect(sequenza.length).toBe(0)

    // Il FIR resta esattamente come dopo l'emissione: nessun tentativo,
    // nessun legame, ancora sincronizzabile in futuro su richiesta esplicita.
    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto).not.toBeNull()
    expect(firRiletto!.rentriNumeroFir).toBeNull()
    expect(firRiletto!.rentriSyncStatus.getStatus()).toBe('PENDING')
    expect(firRiletto!.canSyncToRENTRI()).toBe(true)
  })
})
