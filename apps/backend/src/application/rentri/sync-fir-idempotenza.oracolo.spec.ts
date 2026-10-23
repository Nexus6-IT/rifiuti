import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { RentriAuthService } from '../../infrastructure/rentri/rentri-auth.service'
import { RentriCredentialResolver } from '../../infrastructure/rentri/rentri-credential.resolver'
import { RentriConfig } from '../../infrastructure/rentri/rentri-config'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { costruttorePayloadFinto } from './mappatura/aiuti-test'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

const TENANT_ID = 'tenant-b1-t7'
const RADICE_FORMULARI = '/formulari/v1.0/'

/**
 * Piano B, pezzo 1, Task 7: prova end-to-end che la creazione del FIR sull'ente
 * e' idempotente. Si contano le `POST /` che la fake RENTRI riceve davvero
 * (hook `onRequest` di Fastify), non le chiamate a un mock: un solo formulario
 * per FIR anche con polling scaduto e job concorrenti.
 *
 * Lo use case e' quello reale, il client e' il `RENTRIApiClient` reale
 * collegato alla fake in-process (`app.inject()`); il repository e' in memoria
 * ma con la stessa semantica del Postgres (v. `fir-prisma.repository.ts`): la
 * semantica SQL e' provata dai test Postgres, qui serve a far girare il flusso.
 */
describe('Idempotenza della creazione del FIR contro la fake RENTRI (in-process)', () => {
  let app: any
  let postRicevute: number

  beforeAll(async () => {
    app = creaApp()
    app.addHook('onRequest', async (richiesta: any) => {
      const path = String(richiesta.url).split('?')[0]
      if (richiesta.method === 'POST' && path === RADICE_FORMULARI) postRicevute++
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    postRicevute = 0
  })

  afterEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
  })

  function creaClient(): RENTRIApiClient {
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
    // Ogni azienda del test ha un certificato proprio (uguale a quello di prova): la
    // credenziale env e' legata a una sola azienda (RENTRI_ENV_TENANT_ID).
    const credentialService = {
      getForTenant: jest.fn().mockResolvedValue({
        clientId: config.clientId,
        certificatePem: config.certificatePem,
        privateKeyPem: config.privateKeyPem,
        algorithm: config.algorithm,
        environment: 'demo',
      }),
    }
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
    }
    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (url: string, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsedUrl = new URL(url)
          app
            .inject({
              method: 'GET',
              url: `${parsedUrl.pathname}${parsedUrl.search}`,
              headers: opts.headers,
            })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }
    const client = new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)

    // Il polling di default (30 tentativi) renderebbe il test lento: lo use case
    // non permette di passare le opzioni, quindi si stringe qui il client del
    // test. Il default di produzione non cambia.
    const attendiEsitoReale = client.attendiEsito.bind(client)
    jest
      .spyOn(client, 'attendiEsito')
      .mockImplementation((tenantId: string, transazioneId: string) =>
        attendiEsitoReale(tenantId, transazioneId, { maxTentativi: 1, intervalloMs: 1 })
      )
    return client
  }

  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any
  ): void {
    const adattata: AxiosResponse = {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
    if (adattata.status >= 400) {
      const errore: any = new Error(`Richiesta fallita con status ${adattata.status}`)
      errore.response = adattata
      subscriber.error(errore)
      return
    }
    subscriber.next(adattata)
    subscriber.complete()
  }

  /** Copia profonda che conserva i prototipi (aggregate e value object). */
  function clona<T>(valore: T): T {
    if (valore === null || typeof valore !== 'object') return valore
    if (valore instanceof Date) return new Date(valore.getTime()) as unknown as T
    if (valore instanceof Map) {
      return new Map([...valore].map(([k, v]) => [k, clona(v)])) as unknown as T
    }
    if (valore instanceof Set) return new Set([...valore].map(clona)) as unknown as T
    if (Array.isArray(valore)) return valore.map(clona) as unknown as T
    const copia = Object.create(Object.getPrototypeOf(valore))
    for (const chiave of Object.keys(valore as object)) {
      copia[chiave] = clona((valore as any)[chiave])
    }
    return copia
  }

  /**
   * Repository in memoria con la semantica del Postgres: ogni lettura rida'
   * una copia (due esecuzioni non condividono lo stesso oggetto), la
   * prenotazione e' un compare-and-set e il salvataggio conserva i campi di
   * trasmissione del database quando l'aggregate porta un avvio piu' vecchio.
   */
  class RepositoryFirInMemoria {
    private readonly righe = new Map<string, FIR>()

    inserisci(fir: FIR): void {
      this.righe.set(fir.id, clona(fir))
    }

    async findById(id: string): Promise<FIR | null> {
      const riga = this.righe.get(id)
      return riga ? clona(riga) : null
    }

    async prenotaTrasmissioneRentri(
      firId: string,
      tenantId: string,
      ora: Date,
      sogliaStallo: Date
    ): Promise<boolean> {
      const riga = this.righe.get(firId)
      if (!riga || riga.tenantId !== tenantId) return false
      if (riga.rentriNumeroFir !== null) return false
      if ((riga.stato as string) === 'ANNULLATO') return false
      const stato = riga.rentriSyncStatus.getStatus()
      const avviato = riga.rentriSyncAvviatoAt
      const prenotabile =
        stato === 'PENDING' ||
        stato === 'FAILED' ||
        (stato === 'SYNCING' && (!avviato || avviato.getTime() < sogliaStallo.getTime()))
      if (!prenotabile) return false
      riga.avviaTentativoRentri(ora)
      return true
    }

    async registraTransazioneInAttesa(
      firId: string,
      tenantId: string,
      transazioneId: string,
      avviatoAt: Date
    ): Promise<boolean> {
      const riga = this.righe.get(firId)
      if (!riga || riga.tenantId !== tenantId) return false
      const avviato = riga.rentriSyncAvviatoAt
      if (
        riga.rentriSyncStatus.getStatus() !== 'SYNCING' ||
        !avviato ||
        avviato.getTime() !== avviatoAt.getTime()
      ) {
        return false
      }
      riga.registraTransazioneInAttesa(transazioneId)
      return true
    }

    async save(fir: FIR): Promise<void> {
      const salvata = this.righe.get(fir.id)
      const avvioAggregate = fir.rentriSyncAvviatoAt
      const avvioSalvato = salvata?.rentriSyncAvviatoAt
      if (
        salvata &&
        avvioSalvato &&
        (!avvioAggregate || avvioAggregate.getTime() < avvioSalvato.getTime())
      ) {
        // Prenotazione viva di un altro processo: l'aggregate stantio non la sovrascrive.
        return
      }
      this.righe.set(fir.id, clona(fir))
    }
  }

  function firEmesso(): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-1',
      rifiuto: {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
        statoFisico: 'Liquido',
        caratteristichePericolo: 'HP14',
      },
      trasportatoreId: 'trasportatore-1',
      destinatarioId: 'destinatario-1',
      tenantId: TENANT_ID,
    })
    fir.emetti('FIR-2026-000001', {
      firmatario: 'Produttore',
      timestamp: new Date(),
      certificato: 'cert',
    })
    fir.clearDomainEvents()
    return fir
  }

  function creaUseCase(repository: RepositoryFirInMemoria, client: RENTRIApiClient) {
    const syncLogRepository: any = {
      createPending: jest.fn(async (p: any) => RENTRISyncLog.createPending(p)),
      save: jest.fn(async (l: any) => l),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const domainEvents: any = { publish: jest.fn() }
    return new SyncFIRToRENTRIUseCase(
      repository as any,
      client,
      syncLogRepository,
      domainEvents,
      logger,
      costruttorePayloadFinto()
    )
  }

  it("polling scaduto e nuovo tentativo: una sola POST / sulla fake, FIR legato al numero dell'esito", async () => {
    const repository = new RepositoryFirInMemoria()
    const fir = firEmesso()
    repository.inserisci(fir)
    const client = creaClient()
    const useCase = creaUseCase(repository, client)
    const numeroFir = 'BCDFGH00070ZZ'

    // 1. La transazione non e' ancora completata: il polling scade.
    const primo = await useCase.execute(fir.id, TENANT_ID)
    expect(primo).toMatchObject({ success: false, willRetry: true })
    expect(postRicevute).toBe(1)

    const dopoPrimo = await repository.findById(fir.id)
    const transazioneId = dopoPrimo!.rentriTransazioneInAttesa
    expect(transazioneId).toEqual(expect.any(String))

    // 2. L'ente completa la transazione con un esito che porta il numero.
    const completamento = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: transazioneId,
        errore: false,
        validazione: [],
        esito: { numero_fir: numeroFir },
      },
    })
    expect(completamento.statusCode).toBe(200)

    // 3. Il secondo tentativo riprende la transazione, senza nuova POST.
    const secondo = await useCase.execute(fir.id, TENANT_ID)
    expect(secondo).toMatchObject({ success: true, protocolNumber: numeroFir })

    expect(postRicevute).toBe(1)
    const finale = await repository.findById(fir.id)
    expect(finale!.rentriNumeroFir).toBe(numeroFir)
  }, 30000)

  it('due execute concorrenti sullo stesso FIR: una sola POST /', async () => {
    const repository = new RepositoryFirInMemoria()
    const fir = firEmesso()
    repository.inserisci(fir)
    const client = creaClient()
    const useCaseA = creaUseCase(repository, client)
    const useCaseB = creaUseCase(repository, client)

    const [a, b] = await Promise.all([
      useCaseA.execute(fir.id, TENANT_ID),
      useCaseB.execute(fir.id, TENANT_ID),
    ])

    expect(postRicevute).toBe(1)
    // Uno ha trasmesso (polling scaduto, ritentabile), l'altro ha perso la prenotazione.
    const esiti = [a, b]
    expect(esiti.filter(e => e.giaInCorso === true)).toHaveLength(1)
    expect(esiti.filter(e => e.giaInCorso !== true)).toEqual([
      expect.objectContaining({ success: false, willRetry: true }),
    ])
  }, 30000)
})
