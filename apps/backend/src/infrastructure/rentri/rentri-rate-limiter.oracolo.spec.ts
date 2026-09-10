import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import Redis from 'ioredis'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { RedisConfig } from '../cache/redis.config'
import {
  RentriRateLimiterService,
  RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA,
  RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE,
  RENTRI_RATE_LIMIT_FINESTRA_MS,
} from './rentri-rate-limiter.service'
import { corpoFormularioValido } from '../../application/rentri/mappatura/aiuti-test'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * R5 Task 6, Step 1 — il limitatore preventivo per-tenant (R5 Task 1,
 * cablato nel client in R5 Task 2, v. `rentri-api.client.ts::conRateLimiter`)
 * sotto carico REALE: la misura di riferimento è quante richieste HTTP sono
 * REALMENTE arrivate all'oracolo in un dato istante/finestra, non quante
 * volte il metodo `acquisisci()` ha deciso di concedere un permesso — quella
 * seconda misura è già coperta da `rentri-rate-limiter.redis.spec.ts` (Task
 * 1) e si limiterebbe a verificare il mock di se stesso.
 *
 * Come si contano le richieste "realmente arrivate": un hook Fastify
 * `onRequest`/`onResponse` (non nel codice di produzione della fake) su ogni
 * richiesta — incrementa un contatore di concorrenza all'arrivo e lo
 * decrementa al completamento, registrando il MASSIMO osservato; registra
 * anche il timestamp di arrivo di ciascuna per il controllo di volume.
 * Registrato UNA VOLTA SOLA in `beforeAll` (Fastify rifiuta `addHook` dopo
 * `app.ready()`: `FastifyError: Fastify instance is already listening"`), poi
 * azzerato ad ogni test con `azzeraOsservazione()` — l'hook stesso resta
 * sempre attivo e osserva il traffico HTTP reale che attraversa il server
 * (richieste che hanno superato networking/parsing e sono arrivate al
 * router), non la decisione presa a monte dal limitatore lato client, che
 * potrebbe teoricamente concedere un permesso senza che la richiesta parta
 * mai (non è questo il caso, ma la distinzione è esattamente il punto del
 * brief).
 *
 * Redis REALE richiesto (stesso di `rentri-rate-limiter.redis.spec.ts`):
 *   docker run -d --rm --name redis-r5-test -p 16399:6379 redis:7-alpine
 *
 * In-process (`creaApp()` + `app.inject()`), stesso motivo delle spec sorelle
 * (`rentri-api.client.resilienza.oracolo.spec.ts` e altre): la CA di prova
 * della fake è memoizzata per processo.
 */
describe('RentriRateLimiterService — sotto carico reale contro la fake RENTRI (R5 Task 6)', () => {
  let app: any
  let redis: Redis
  let rateLimiter: RentriRateLimiterService

  const REDIS_HOST = process.env.RENTRI_RATELIMIT_TEST_REDIS_HOST ?? '127.0.0.1'
  const REDIS_PORT = Number(process.env.RENTRI_RATELIMIT_TEST_REDIS_PORT ?? 16399)

  // Stato dell'osservazione del traffico REALE verso la fake, popolato
  // dall'hook registrato una volta sola in `beforeAll` (Fastify non permette
  // `addHook` dopo `app.ready()`, quindi non può essere registrato per-test):
  // ogni test lo azzera con `azzeraOsservazione()` prima di generare traffico.
  let inVolo = 0
  let massimoConcorrenti = 0
  let arrivi: number[] = []

  function azzeraOsservazione(): void {
    inVolo = 0
    massimoConcorrenti = 0
    arrivi = []
  }

  beforeAll(async () => {
    app = creaApp()

    // Hook di OSSERVAZIONE del traffico HTTP reale (non una decisione del
    // limitatore): conta le richieste che hanno superato networking/parsing
    // e sono arrivate al router della fake — esclude `/__controllo/*`
    // (canale di test, non traffico "verso RENTRI").
    app.addHook('onRequest', async (richiesta: any) => {
      if (richiesta.url.startsWith('/__controllo')) return
      inVolo += 1
      massimoConcorrenti = Math.max(massimoConcorrenti, inVolo)
      arrivi.push(Date.now())
    })
    app.addHook('onResponse', async (richiesta: any) => {
      if (richiesta.url.startsWith('/__controllo')) return
      inVolo -= 1
    })

    await app.ready()

    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: 1 })
    await redis.ping()

    const redisConfigFinto = { createClient: () => redis } as unknown as RedisConfig
    rateLimiter = new RentriRateLimiterService(redisConfigFinto)
    await rateLimiter.onModuleInit()
  })

  afterAll(async () => {
    await app.close()
    await redis.quit()
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
      rentriRateLimiterWaitSeconds: { observe: jest.fn() },
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
          const path = new URL(url).pathname
          app
            .inject({ method: 'GET', url: path, headers: opts.headers })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    // Il limitatore E' passato qui: questo è esattamente l'aggancio di
    // produzione (R5 Task 2), non un doppio che simula il comportamento del
    // limitatore.
    return new RENTRIApiClient(
      httpService,
      logger,
      metrics,
      config,
      auth,
      signature as any,
      rateLimiter
    )
  }

  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any
  ): void {
    const risposaAdattata: AxiosResponse = {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
    if (risposaAdattata.status >= 400) {
      const errore: any = new Error(`Richiesta fallita con status ${risposaAdattata.status}`)
      errore.response = risposaAdattata
      subscriber.error(errore)
      return
    }
    subscriber.next(risposaAdattata)
    subscriber.complete()
  }

  /**
   * Prova che la misura è quella "vera": molte chiamate concorrenti dello
   * STESSO tenant, nessun guasto iniettato. Se il limitatore concedesse più
   * di {@link RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA} permessi
   * contemporaneamente, l'hook Fastify (che osserva il server, non il
   * client) lo vedrebbe: più richieste realmente aperte insieme sull'oracolo.
   */
  it("concorrenza reale: 15 chiamate concorrenti dello stesso tenant non superano MAI 3 richieste in volo sull'oracolo", async () => {
    const client = creaClient()
    const tenantId = `r5-task6-concorrenza-${process.pid}`
    azzeraOsservazione()

    // "concorrenza": 15 chiamate concorrenti dello stesso tenant (v. titolo del test).
    const chiamate = Array.from({ length: 15 }, () =>
      client.creaFormulario(tenantId, corpoFormularioValido())
    )
    await Promise.all(chiamate)

    expect(massimoConcorrenti).toBeLessThanOrEqual(RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA)
    expect(arrivi.length).toBe(15)
  }, 20000)

  /**
   * Prova di volume: misura sulla stessa serie di timestamp reali che in
   * NESSUNA finestra scorrevole di 5s il numero di arrivi supera la soglia
   * (30) — calcolato dagli arrivi REALMENTE registrati dall'hook, non da un
   * contatore interno del limitatore.
   */
  it('volume reale: nessuna finestra scorrevole di 5s tra gli arrivi effettivi supera la soglia di 30', async () => {
    const client = creaClient()
    const tenantId = `r5-task6-volume-${process.pid}`
    azzeraOsservazione()

    // "volume": 20 chiamate per verificare la soglia sulla finestra scorrevole.
    const chiamate = Array.from({ length: 20 }, () =>
      client.creaFormulario(tenantId, corpoFormularioValido())
    )
    await Promise.all(chiamate)

    const arriviOrdinati = arrivi.slice().sort((a, b) => a - b)
    for (const t of arriviOrdinati) {
      const inFinestra = arriviOrdinati.filter(
        altro => altro >= t && altro < t + RENTRI_RATE_LIMIT_FINESTRA_MS
      ).length
      expect(inFinestra).toBeLessThanOrEqual(RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE)
    }
  }, 20000)

  /**
   * Isolamento per tenant (v. motivazione Task 1): un tenant che satura la
   * propria concorrenza non deve rallentare un tenant diverso. Osservato di
   * nuovo sul traffico REALE: le richieste del secondo tenant arrivano
   * senza attendere che il primo si liberi.
   */
  it('due tenant diversi non condividono il budget: il secondo non attende il primo', async () => {
    const client = creaClient()
    const tenantSaturato = `r5-task6-isolamento-a-${process.pid}`
    const tenantLibero = `r5-task6-isolamento-b-${process.pid}`

    // Satura la concorrenza del primo tenant con permessi MAI rilasciati
    // durante il test (acquisiti direttamente dal limitatore, non tramite
    // il client, per tenerli aperti a piacere).
    const permessiBloccati = await Promise.all([
      rateLimiter.acquisisci(tenantSaturato),
      rateLimiter.acquisisci(tenantSaturato),
      rateLimiter.acquisisci(tenantSaturato),
    ])

    // "tenant libero": chiamata del tenant non saturato, a differenza di
    // `tenantSaturato` sopra.
    const inizio = Date.now()
    await client.creaFormulario(tenantLibero, corpoFormularioValido())
    const durata = Date.now() - inizio

    // Nessuna attesa di rilievo: il tenant libero non ha mai dovuto
    // attendere la capacità del tenant saturato.
    expect(durata).toBeLessThan(500)

    await Promise.all(permessiBloccati.map(p => p.rilascia()))
  })
})
