import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { SyncFIRToRENTRIUseCase } from '../../application/rentri/sync-fir-to-rentri.use-case'
import { costruttorePayloadFinto } from '../../application/rentri/mappatura/aiuti-test'
import { FIR, FIRStato, FirmaDigitale } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Task 5 (R0): il criterio di uscita di R0. Tutti i pezzi del legame FIR ↔
 * RENTRI esistono e sono cablati singolarmente (client REST, use case,
 * aggregate, repository dei log), ma nessuno spec precedente dimostra che
 * FUNZIONINO INSIEME: `SyncFIRToRENTRIUseCase.execute()` reale, contro la
 * fake RENTRI istanziata in-process, su un FIR di dominio vero — e poi la
 * domanda che conta davvero: **il legame resta scritto quando si rilegge il
 * FIR dal repository?**
 *
 * Il percorso completo, passo per passo:
 * 1. un FIR in stato EMESSO (canSyncToRENTRI() vero);
 * 2. creaFormulario → 202 con transazione_id + Location;
 * 3. polling: interrogaStatoTransazione osserva almeno un 200 ("in
 *    elaborazione") mentre la transazione si completa in background, poi un
 *    303 con Location all'esito pronto — lo stesso schema di
 *    `rentri-api.client.polling-reale.oracolo.spec.ts`, qui esercitato
 *    dentro il ciclo reale del use case (nessun intervento manuale sul
 *    polling);
 * 4. l'esito porta `numero_fir` dentro `esito.esito`
 *    (`EsitoNuovoFormularioModel`, v.
 *    `rentri-api.client.numero-fir.oracolo.spec.ts`);
 * 5. **il FIR riletto dal repository (una chiamata `findById` distinta da
 *    quella che il use case ha usato per salvare) porta il numero ufficiale,
 *    lo stato SYNCED e l'origine TRASMESSO_DA_NOI**.
 *
 * **Limite dichiarato sulla persistenza**: il repository FIR usato qui è una
 * finta in memoria (`Map`), non Postgres reale. L'aggregate `FIR` ha
 * costruttore privato e nessun metodo `fromPersistence`/`reconstitute`
 * pubblico (solo `FIR.create`, che forza lo stato BOZZA): un repository reale
 * dovrebbe comunque passare per l'istanza in memoria per ricostruire
 * l'aggregate da una riga di database, quindi anche una "rilettura" con un
 * repository reale otterrebbe la stessa identica istanza logica. Questo
 * spec dimostra dunque che il FLUSSO (creaFormulario → attendiEsito →
 * markRENTRISynced → save → findById) produce un FIR con il legame scritto
 * correttamente — la persistenza fisica su Postgres (che la rilettura
 * sopravviva a un processo diverso) è già stata verificata a parte nel
 * Task 3 (`rentri-sync-log.repository.spec.ts` e la suite del repository
 * FIR). Non va scambiata l'una per l'altra.
 *
 * Istanziata IN-PROCESS con `creaApp()` + `app.inject()` (non contro
 * l'oracolo su http://localhost:4010): la CA di prova della fake è
 * memoizzata per processo, quindi un certificato emesso qui non sarebbe
 * riconosciuto da un processo diverso — v. le spec sorelle.
 */
describe('SyncFIRToRENTRIUseCase — ciclo end-to-end contro la fake RENTRI (in-process)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * Repository FIR in memoria: `save`/`findById` distinti, per dimostrare
   * che il legame scritto dal use case è visibile a una lettura successiva
   * indipendente — non solo che l'istanza passata a `save` è stata mutata
   * in place (v. nota sul limite dichiarato in testa al file).
   */
  class FIRRepositoryFake implements Pick<IFIRRepository, 'findById' | 'save'> {
    private readonly memoria = new Map<string, FIR>()

    async findById(id: string): Promise<FIR | null> {
      return this.memoria.get(id) ?? null
    }

    async save(fir: FIR): Promise<void> {
      this.memoria.set(fir.id, fir)
    }
  }

  /** Costruisce un FIR di dominio reale, portato allo stato EMESSO. */
  function creaFIREmesso(tenantId: string): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-oracolo',
      trasportatoreId: 'trasportatore-oracolo',
      destinatarioId: 'destinatario-oracolo',
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

    fir.emetti('FIR-ORACOLO-000001', firmaProduttore)
    return fir
  }

  /** Registro dei tentativi HTTP osservati (`method status`), nell'ordine reale. */
  function creaClientETracciato(): {
    client: RENTRIApiClient
    sequenza: string[]
    transazioneRef: { id?: string }
  } {
    const cert = creaCertificatoDiTest('operatore-test')

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

    /**
     * Adattatore fedele al comportamento reale di axios (v.
     * `rentri-api.client.resilienza.oracolo.spec.ts`): senza
     * `validateStatus` (o se non soddisfatto), uno status >= 400 fa fallire
     * l'observable con un errore che porta `error.response` — indispensabile
     * per il caso negativo di questo spec, dove il 403 iniettato deve
     * arrivare al client come un errore da classificare
     * (`gestisciRispostaNonPrevista`/`RentriApiError`), non come una
     * risposta 2xx qualunque. L'adattatore "risolve sempre" usato dalle spec
     * sorelle sul solo percorso positivo non basterebbe qui.
     */
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

      // Cattura la transazione_id creata dalla vera chiamata di dominio
      // (POST alla radice del servizio, 202): serve a pilotare il
      // completamento asincrono dal canale di controllo, senza duplicare la
      // richiesta di creazione.
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

  /** Coppia repository log + eventi di dominio: finte in memoria, come nello spec unitario del use case. */
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

  it("caso positivo: EMESSO → 202 → polling (200 poi 303) → numero_fir nell'esito → il FIR riletto dal repository porta il legame", async () => {
    const tenantId = 'tenant-oracolo-positivo'
    const fir = creaFIREmesso(tenantId)
    expect(fir.stato).toBe(FIRStato.EMESSO)
    expect(fir.canSyncToRENTRI()).toBe(true)

    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    const { client, sequenza, transazioneRef } = creaClientETracciato()
    const { syncLogRepository, domainEvents, eventiPubblicati, logger } =
      creaDipendenzeApplicative()

    const useCase = new SyncFIRToRENTRIUseCase(
      firRepository as any,
      client,
      syncLogRepository,
      domainEvents,
      logger,
      costruttorePayloadFinto()
    )

    // Completa la transazione con un timer REALE (non un fake timer di
    // Jest, che bloccherebbe app.inject() — v.
    // rentri-api.client.polling-reale.oracolo.spec.ts) schedulato quando la
    // transazione_id diventa nota (subito dopo il 202 di creaFormulario,
    // catturata dall'adattatore httpService.post sopra): la prima
    // interrogazione di /status trova la transazione ancora aperta (200
    // atteso), la successiva — dopo l'intervallo di polling di default del
    // client (2000ms) — la trova completata (303 atteso).
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

    const risultatoPromise = useCase.execute(fir.id, tenantId, 'correlazione-positiva')

    void attendiTransazioneId().then(transazioneId => {
      setTimeout(() => {
        void app.inject({
          method: 'POST',
          url: '/__controllo/completa-transazione',
          payload: {
            transazione_id: transazioneId,
            errore: false,
            validazione: [],
            esito: { numero_fir: 'RENTRI-ORACOLO-000123' },
          },
        })
      }, 150)
    })

    const risultato = await risultatoPromise

    expect(risultato.success).toBe(true)
    expect(risultato.protocolNumber).toBe('RENTRI-ORACOLO-000123')

    // Sequenza HTTP realmente osservata (ciascuna voce: "METODO path status"):
    // 202 alla creazione, poi almeno un 200 su /status ("in elaborazione")
    // seguito da un 303 ("pronto"), infine 200 su /result con l'esito.
    const codiceDi = (voce: string): number => Number(voce.trim().split(' ').pop())
    expect(sequenza[0].startsWith('POST') && sequenza[0].endsWith(' 202')).toBe(true)

    const chiamateStato = sequenza.filter(voce => voce.includes('/status '))
    const codiciStato = chiamateStato.map(codiceDi)
    expect(codiciStato).toContain(200)
    expect(codiciStato[codiciStato.length - 1]).toBe(303)
    expect(codiciStato.indexOf(200)).toBeLessThan(codiciStato.lastIndexOf(303))

    const chiamateEsito = sequenza.filter(voce => voce.includes('/result '))
    expect(chiamateEsito.length).toBeGreaterThan(0)
    expect(codiceDi(chiamateEsito[chiamateEsito.length - 1])).toBe(200)

    // Il punto che conta: una rilettura DISTINTA dal repository porta il
    // numero ufficiale, non solo l'istanza mutata in memoria dal use case.
    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto).not.toBeNull()
    expect(firRiletto!.rentriNumeroFir).toBe('RENTRI-ORACOLO-000123')
    expect(firRiletto!.rentriSyncStatus.getStatus()).toBe('SYNCED')
    expect(firRiletto!.rentriOrigineLegame).toBe('TRASMESSO_DA_NOI')

    expect(eventiPubblicati.length).toBeGreaterThan(0)
  }, 15000)

  it('caso negativo: guasto 403 iniettato — la trasmissione fallisce e il FIR NON risulta legato', async () => {
    const tenantId = 'tenant-oracolo-negativo'
    const fir = creaFIREmesso(tenantId)

    const firRepository = new FIRRepositoryFake()
    await firRepository.save(fir)

    const { client } = creaClientETracciato()
    const { syncLogRepository, domainEvents, logSalvati, logger } = creaDipendenzeApplicative()

    const useCase = new SyncFIRToRENTRIUseCase(
      firRepository as any,
      client,
      syncLogRepository,
      domainEvents,
      logger,
      costruttorePayloadFinto()
    )

    // Guasto iniettato dal canale di controllo: la prossima chiamata
    // (creaFormulario) riceve un 403 "operazione non consentita" — v.
    // RENTRIApiClient.gestisciRispostaNonPrevista, mai ritentato.
    const impostazioneGuasto = await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 403, volte: 1 },
    })
    expect(impostazioneGuasto.statusCode).toBe(200)

    const risultato = await useCase.execute(fir.id, tenantId, 'correlazione-negativa')

    expect(risultato.success).toBe(false)
    expect(risultato.willRetry).toBe(false)
    expect(typeof risultato.error).toBe('string')
    expect(risultato.error!.length).toBeGreaterThan(0)

    // Il punto che conta quanto il caso positivo: nessun numero ufficiale
    // scritto, nessun legame — né sull'istanza usata dal use case né su
    // una rilettura distinta dal repository.
    const firRiletto = await firRepository.findById(fir.id)
    expect(firRiletto).not.toBeNull()
    expect(firRiletto!.rentriNumeroFir).toBeNull()
    expect(firRiletto!.rentriSyncStatus.getStatus()).not.toBe('SYNCED')
    // R1: un 403 (credenziale/certificato non valido) NON è più ritentabile
    // automaticamente — ritentare ostinatamente lo stesso errore è il modo
    // più diretto per farsi bandire (423) dall'ente. Il FIR passa subito a
    // PERMANENTLY_FAILED (richiede intervento manuale sul certificato), non
    // resta ritrasmissibile in attesa di un nuovo giro.
    expect(firRiletto!.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
    expect(firRiletto!.canSyncToRENTRI()).toBe(false)

    // Il log di sincronizzazione registra il fallimento (leggibile), non un successo mascherato.
    expect(logSalvati.length).toBeGreaterThan(0)
    expect(logSalvati[0].tipo).toBe('FAILURE')
  }, 15000)
})
