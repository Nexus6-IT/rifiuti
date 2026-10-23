import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RiconciliaStatoRentriUseCase } from './riconcilia-stato-rentri.use-case'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { RentriAuthService } from '../../infrastructure/rentri/rentri-auth.service'
import { RentriCredentialResolver } from '../../infrastructure/rentri/rentri-credential.resolver'
import { RentriConfig } from '../../infrastructure/rentri/rentri-config'
import { corpoFormularioValido } from './mappatura/aiuti-test'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R5 Task 6, Step 4 — il punto PIÙ importante del task: la riconciliazione
 * (R5 Task 4) messa alla prova con una transazione REALE creata e completata
 * dall'oracolo (`tools/rentri-fake`), non con `mockRentriApiClient` come fa
 * `riconcilia-stato-rentri.use-case.spec.ts` (unitario, già esistente e non
 * toccato da questo file).
 *
 * **Scelta di ambito, dichiarata**: `IFIRRepository`/`PrismaService`/
 * `RENTRISyncLogRepository` restano DOPPI (spy-based), non un Postgres reale.
 * Motivo: la promessa da dimostrare in questo Step è "nel caso segnala,
 * NESSUNA scrittura di dominio avviene" — un doppio che espone
 * `markRENTRISynced`/`save` come `jest.fn()` MAI invocati è una prova
 * DIRETTA e più forte di una query di verifica su un Postgres reale (che
 * proverebbe solo "il valore non è cambiato", non "il metodo non è mai stato
 * chiamato" — un aggregate potrebbe restare invariato anche per un bug che
 * lo richiama con lo stesso valore). Il lato REALE qui è quello che il piano
 * chiede di verificare con l'oracolo: la transazione NONBLOCK_PULL vera
 * (creazione → completamento via canale di controllo → lettura reale con
 * `RENTRIApiClient.attendiEsito`, passando per la resilienza vera del
 * client), non un Postgres di supporto che nessuno ha chiesto di introdurre
 * in questo task.
 *
 * **Perché il caso "segnala" usa un esito NEGATIVO (`errore: true`) e non un
 * confronto di `numero_fir`**: il piano suggerisce come esempio "numero_fir
 * locale diverso da quello letto", ma quel confronto non esiste nel codice
 * di `riconciliaSynced` (che confronta SOLO `stato_formulario`, mai
 * `numero_fir` — la lettura è sempre fatta CON quel numero_fir, quindi un
 * confronto su se stesso non avrebbe senso). Riprodurre invece una
 * divergenza di `stato_formulario` contro l'oracolo reale richiederebbe
 * sfruttare un limite noto della fake (`GET /{numero_fir}` restituisce il
 * campo interno `stato`, non `stato_formulario` — verificato anche da
 * `rentri-api.client.oracolo.spec.ts`, che asserisce `.stato` non
 * `.stato_formulario`): userei quindi un difetto della fake per FAR
 * scattare la segnalazione, non una condizione realistica. Il lotto
 * "SYNCING bloccato" invece raggiunge il ramo "segnala" in modo
 * completamente fedele al contratto: una transazione completata con esito
 * negativo (`errore: true`) è una risposta legittima e prevista dell'ente,
 * non un artefatto della fake.
 */
describe('RiconciliaStatoRentriUseCase — contro la fake RENTRI (transazione reale, R5 Task 6)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
  })

  function creaClientReale(): RENTRIApiClient {
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
    const auth = new RentriAuthService(
      new RentriCredentialResolver(credentialService as any, config),
      config,
      logger
    )
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
      rentriRateLimiterWaitSeconds: { observe: jest.fn() },
    }

    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => emetti(subscriber, risposta, undefined))
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
            .then((risposta: any) => emetti(subscriber, risposta, opts.validateStatus))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    // Nessun rate limiter iniettato: quel livello è già verificato sotto
    // carico reale in `rentri-rate-limiter.oracolo.spec.ts` (Step 1) e
    // `rentri-api.client.resilienza.oracolo.spec.ts` (Step 2) — qui
    // l'oggetto in prova è la riconciliazione, non il limitatore.
    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any,
    validateStatus?: (status: number) => boolean
  ): void {
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

  /** Crea davvero una transazione sull'oracolo e la completa, come farebbe l'ente. */
  async function creaETransazioneCompletata(
    client: RENTRIApiClient,
    tenantId: string,
    esito: { errore: boolean; numero_fir?: string }
  ): Promise<string> {
    // "riconciliazione": corpo usato per creare la transazione che il test
    // completerà via canale di controllo, con l'esito passato a questo aiuto.
    const { transazioneId } = await client.creaFormulario(tenantId, corpoFormularioValido())
    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: transazioneId,
        errore: esito.errore,
        validazione: [],
        esito: esito.numero_fir ? { numero_fir: esito.numero_fir } : {},
      },
    })
    return transazioneId
  }

  function firFake(overrides: Partial<Record<string, any>> = {}): any {
    return {
      id: overrides.id ?? 'fir-1',
      tenantId: overrides.tenantId ?? 'tenant-r5-t6',
      rentriTransazioneId: overrides.rentriTransazioneId ?? null,
      rentriNumeroFir: overrides.rentriNumeroFir ?? null,
      rentriNumeroFirProposto: overrides.rentriNumeroFirProposto ?? null,
      rentriStatoFormulario: overrides.rentriStatoFormulario ?? null,
      markRENTRISynced: jest.fn(),
      applyRentriStato: jest.fn(),
      confermaLegameRENTRI: jest.fn(),
      getDomainEvents: jest.fn().mockReturnValue([]),
      clearDomainEvents: jest.fn(),
      ...overrides,
    }
  }

  /** Costruisce il use case con doppi spy-based per tutto tranne il client RENTRI (reale). */
  function creaUseCase(rentriApiClient: RENTRIApiClient, firSyncingId: string) {
    const mockFIRRepository = { findById: jest.fn(), save: jest.fn() }
    const mockPrisma = { fIR: { findMany: jest.fn(), update: jest.fn() } }
    mockPrisma.fIR.findMany.mockImplementation((args: any) => {
      if (args.where.rentriSyncStatus === 'SYNCING') {
        return Promise.resolve([{ id: firSyncingId }])
      }
      return Promise.resolve([])
    })

    const pendingLog = {
      markAsSuccess: jest.fn().mockReturnValue({ id: 'log-1', status: 'SUCCESS' }),
      markAsFailure: jest.fn().mockReturnValue({ id: 'log-1', status: 'FAILURE' }),
    }
    const mockSyncLogRepository = {
      createPending: jest.fn().mockResolvedValue(pendingLog),
      save: jest.fn(),
    }
    const mockDomainEvents = { publish: jest.fn() }
    const mockLogger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const mockMetrics: any = { rentriReconciliationDivergences: { inc: jest.fn() } }

    const useCase = new RiconciliaStatoRentriUseCase(
      mockFIRRepository as any,
      mockPrisma as any,
      rentriApiClient,
      mockSyncLogRepository as any,
      mockDomainEvents as any,
      mockLogger,
      mockMetrics,
      // Tenant AUTOMATICA: la correzione chiude il legame con markRENTRISynced.
      {
        getForTenant: jest
          .fn()
          .mockResolvedValue({ modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }),
      } as any
    )

    return {
      useCase,
      mockFIRRepository,
      mockPrisma,
      mockSyncLogRepository,
      mockDomainEvents,
      mockMetrics,
    }
  }

  it("CORREGGE: transazione reale completata con numero_fir → markRENTRISynced e firRepository.save invocati, con il numero letto DAVVERO dall'oracolo", async () => {
    const client = creaClientReale()
    const tenantId = 'tenant-r5-t6-corregge'
    const numeroFirAtteso = 'BCDFGH00009JK'

    const transazioneId = await creaETransazioneCompletata(client, tenantId, {
      errore: false,
      numero_fir: numeroFirAtteso,
    })

    const fir = firFake({
      id: 'fir-syncing-reale',
      tenantId,
      rentriTransazioneId: transazioneId,
    })
    const { useCase, mockFIRRepository, mockSyncLogRepository } = creaUseCase(client, fir.id)
    mockFIRRepository.findById.mockResolvedValue(fir)

    const risultato = await useCase.execute(tenantId)

    expect(risultato.corretti).toBe(1)
    expect(risultato.segnalati).toBe(0)
    // Il numero_fir con cui l'aggregate viene "riparato" è quello LETTO
    // DAVVERO dall'oracolo tramite il ciclo NONBLOCK_PULL reale
    // (POST / → 202 → GET /status → 303 → GET /result), non un valore
    // impostato a mano nel test.
    expect(fir.markRENTRISynced).toHaveBeenCalledWith(
      numeroFirAtteso,
      transazioneId,
      expect.any(String)
    )
    expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)

    const logSalvato = mockSyncLogRepository.createPending.mock.calls[0][0]
    expect(logSalvato.origine).toBe('RICONCILIAZIONE')
  }, 20000)

  it(
    "SEGNALA (nulla scritto sull'aggregate): transazione reale completata con esito NEGATIVO → " +
      'markRENTRISynced/applyRentriStato/confermaLegameRENTRI MAI chiamati, firRepository.save MAI chiamato — ' +
      'solo una riga di log FAILURE',
    async () => {
      const client = creaClientReale()
      const tenantId = 'tenant-r5-t6-segnala'

      const transazioneId = await creaETransazioneCompletata(client, tenantId, { errore: true })

      const fir = firFake({
        id: 'fir-syncing-negativo',
        tenantId,
        rentriTransazioneId: transazioneId,
      })
      const { useCase, mockFIRRepository, mockSyncLogRepository, mockMetrics } = creaUseCase(
        client,
        fir.id
      )
      mockFIRRepository.findById.mockResolvedValue(fir)

      const risultato = await useCase.execute(tenantId)

      expect(risultato.segnalati).toBe(1)
      expect(risultato.corretti).toBe(0)

      // *** La prova centrale del Task 6, Step 4 ***: nessuno dei metodi di
      // scrittura di dominio è stato invocato — non solo `markRENTRISynced`,
      // ma OGNI metodo che potrebbe mutare l'aggregate FIR. Un `jest.fn()`
      // mai chiamato è una prova diretta ("questo codice non è mai passato
      // di qui"), più forte di una query di verifica su un valore che
      // potrebbe restare invariato per altri motivi.
      expect(fir.markRENTRISynced).not.toHaveBeenCalled()
      expect(fir.applyRentriStato).not.toHaveBeenCalled()
      expect(fir.confermaLegameRENTRI).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).not.toHaveBeenCalled()

      // L'unica scrittura ammessa: la riga di segnalazione nel log di sync.
      expect(mockSyncLogRepository.createPending).toHaveBeenCalledTimes(1)
      const pendingCreato = mockSyncLogRepository.createPending.mock.calls[0][0]
      expect(pendingCreato.origine).toBe('RICONCILIAZIONE')
      const pendingLog = await mockSyncLogRepository.createPending.mock.results[0].value
      expect(pendingLog.markAsFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'RENTRI_RICONCILIAZIONE_ESITO_NEGATIVO',
        })
      )

      expect(mockMetrics.rentriReconciliationDivergences.inc).toHaveBeenCalledWith({
        tenant_id: tenantId,
        esito: 'segnalato',
      })
    },
    20000
  )

  it('isolamento reale: un secondo tenant con la propria transazione reale non interferisce col primo', async () => {
    const clientA = creaClientReale()
    const clientB = creaClientReale()
    const tenantA = 'tenant-r5-t6-isolamento-a'
    const tenantB = 'tenant-r5-t6-isolamento-b'

    const transazioneA = await creaETransazioneCompletata(clientA, tenantA, {
      errore: false,
      numero_fir: 'AAAAAA00001XX',
    })
    const transazioneB = await creaETransazioneCompletata(clientB, tenantB, {
      errore: false,
      numero_fir: 'BBBBBB00002YY',
    })

    const firA = firFake({ id: 'fir-a', tenantId: tenantA, rentriTransazioneId: transazioneA })
    const { useCase: useCaseA, mockFIRRepository: repoA } = creaUseCase(clientA, firA.id)
    repoA.findById.mockResolvedValue(firA)

    const firB = firFake({ id: 'fir-b', tenantId: tenantB, rentriTransazioneId: transazioneB })
    const { useCase: useCaseB, mockFIRRepository: repoB } = creaUseCase(clientB, firB.id)
    repoB.findById.mockResolvedValue(firB)

    await Promise.all([useCaseA.execute(tenantA), useCaseB.execute(tenantB)])

    expect(firA.markRENTRISynced).toHaveBeenCalledWith(
      'AAAAAA00001XX',
      transazioneA,
      expect.any(String)
    )
    expect(firB.markRENTRISynced).toHaveBeenCalledWith(
      'BBBBBB00002YY',
      transazioneB,
      expect.any(String)
    )
  }, 20000)
})
