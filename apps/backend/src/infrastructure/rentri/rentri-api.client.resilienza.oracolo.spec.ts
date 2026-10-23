import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import * as http from 'node:http'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Redis from 'ioredis'
import { RENTRIApiClient, RentriApiError, TrasmissioneRentriIncertaError } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { RedisConfig } from '../cache/redis.config'
import { RentriRateLimiterService } from './rentri-rate-limiter.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { corpoFormularioValido } from '../../application/rentri/mappatura/aiuti-test'

const execFileAsync = promisify(execFile)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Task 4 (P2): verifica REALE (non mockata) della resilienza del client
 * contro la fake fedele al contratto RENTRI (tools/rentri-fake), guasti
 * inclusi. Istanziata IN-PROCESS con `creaApp()` + `app.inject()` — non
 * contro l'oracolo separato su http://localhost:4010 — per lo stesso motivo
 * di `rentri-api.client.oracolo.spec.ts`: la CA di prova della fake è
 * memoizzata per processo, quindi un certificato emesso in un processo
 * diverso non sarebbe mai riconosciuto qui.
 *
 * A differenza dell'adattatore usato in `rentri-api.client.oracolo.spec.ts`
 * (che risolve SEMPRE l'observable, qualunque sia lo status), questo
 * adattatore replica il comportamento reale di axios: una risposta >= 400
 * fa fallire l'observable con un errore che porta `error.response` — a meno
 * che la chiamata passi esplicitamente `validateStatus` (come fa
 * `RENTRIApiClient` per `/status` e `/result`, dove deve poter distinguere
 * 200/303/400 senza che axios sollevi un'eccezione). Senza questa fedeltà,
 * il guasto iniettato dal canale di controllo (`/__controllo/guasto`) non
 * arriverebbe mai al client come un errore da gestire.
 */
describe('RENTRIApiClient — resilienza contro la fake RENTRI (in-process, guasti iniettati)', () => {
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

  function creaClient(opzioni?: {
    metrics?: any
    rateLimiter?: RentriRateLimiterService
  }): RENTRIApiClient {
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
    // R5 Task 6, Step 2/3: alcuni test qui sotto passano una MetricsService
    // REALE (non un doppio) per interrogare `/metrics` per davvero — v. le
    // due describe aggiunte in coda al file. Il default resta il doppio
    // preesistente, per non toccare i test già scritti sopra.
    const metrics: any = opzioni?.metrics ?? {
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

    return new RENTRIApiClient(
      httpService,
      logger,
      metrics,
      config,
      auth,
      signature as any,
      opzioni?.rateLimiter
    )
  }

  /**
   * Adatta la risposta Fastify in un `AxiosResponse` e replica la semantica
   * reale di axios: senza `validateStatus` (o se non soddisfatto), uno
   * status >= 400 fa fallire l'observable con un errore `error.response`.
   */
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

  function impostaGuasto(stato: number, volte: number): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato, volte },
    })
  }

  /**
   * Prova 1: con 429 iniettato due volte, il client ritenta (rispettando
   * l'header `Retry-After` impostato dalla fake, v. app.ts) e alla fine
   * riesce. Nessun fake timer qui: `app.inject()` di Fastify si appoggia a
   * `setImmediate`/microtask interni che i fake timers di Jest
   * bloccherebbero (verificato: il test resta appeso). Si attende quindi
   * realmente il `Retry-After` fisso di 5s x 2 tentativi falliti.
   */
  it('creaFormulario: con 429 iniettato due volte, il client ritenta rispettando Retry-After e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(429, 2)

    const risultato = await client.creaFormulario('', corpoFormularioValido())

    expect(risultato.transazioneId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  }, 20000)

  /**
   * Prova 2: con 503 iniettato una volta, la creazione NON ritenta (la POST
   * non è idempotente: RENTRI potrebbe aver già registrato il FIR) e solleva
   * `TrasmissioneRentriIncertaError`. La prova che non ci sia stato alcun
   * ritentativo è che il guasto (una sola occorrenza) è consumato da una SOLA
   * richiesta.
   */
  it('creaFormulario: con 503 iniettato una volta, il client NON ritenta e solleva TrasmissioneRentriIncertaError', async () => {
    const client = creaClient()
    await impostaGuasto(503, 1)

    const spia = jest.spyOn(app.archivio, 'guastoAttivo')

    const errore = await client.creaFormulario('', corpoFormularioValido()).catch((e: unknown) => e)

    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore).toMatchObject({ causa: 'HTTP_5XX', status: 503 })
    expect(spia).toHaveBeenCalledTimes(1)

    spia.mockRestore()
  }, 15000)

  /**
   * Prova 3: con 403 iniettato, il client NON ritenta e fallisce subito con
   * un esito definitivo (`RentriApiError.retryable === false`). La prova che
   * non ci sia stato alcun ritentativo è che il guasto (impostato per una
   * sola occorrenza) risulta interamente consumato da una SOLA richiesta.
   */
  it('creaFormulario: con 403 iniettato, il client NON ritenta e fallisce subito con esito definitivo', async () => {
    const client = creaClient()
    await impostaGuasto(403, 1)

    const spia = jest.spyOn(app.archivio, 'guastoAttivo')

    let erroreCatturato: unknown
    let sollevato = false
    try {
      await client.creaFormulario('', corpoFormularioValido())
    } catch (errore) {
      sollevato = true
      erroreCatturato = errore
    }

    expect(sollevato).toBe(true)
    expect(erroreCatturato).toBeInstanceOf(RentriApiError)
    expect(erroreCatturato).toMatchObject({ status: 403, retryable: false })

    // Una sola chiamata HTTP: il client non ha ritentato dopo il 403.
    expect(spia).toHaveBeenCalledTimes(1)

    spia.mockRestore()
  })

  /**
   * R5 Task 6, Step 2 — il limitatore preventivo per-tenant (R5 Task 1,
   * cablato nel client in R5 Task 2) DEVE restare un livello distinto dalla
   * resilienza per-chiamata già verificata sopra: iniettando un 429 con
   * `Retry-After` reale, il tempo totale atteso deve continuare a essere
   * SOLO quello dell'header — se il limitatore preventivo aggiungesse una
   * propria attesa sopra quella già corretta, avremmo sommato due ritardi
   * senza motivo (esattamente il rischio descritto nel piano R5 Task 2,
   * Step 2). Qui il limitatore è REALE (Redis reale, non un doppio): un
   * tenant nuovo, ben sotto la soglia di 30 richieste/5s e 3 concorrenti, non
   * deve MAI attendere il proprio limitatore — quindi l'unico tempo che ci si
   * aspetta di misurare è quello di `Retry-After`.
   *
   * Redis reale richiesto, stesso di `rentri-rate-limiter.redis.spec.ts`:
   *   docker run -d --rm --name redis-r5-test -p 16399:6379 redis:7-alpine
   */
  describe('R5 Task 6, Step 2 — limitatore preventivo reale + 429/Retry-After: nessuna sovrapposizione', () => {
    let redis: Redis
    let rateLimiter: RentriRateLimiterService

    const REDIS_HOST = process.env.RENTRI_RATELIMIT_TEST_REDIS_HOST ?? '127.0.0.1'
    const REDIS_PORT = Number(process.env.RENTRI_RATELIMIT_TEST_REDIS_PORT ?? 16399)

    beforeAll(async () => {
      redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: 1 })
      await redis.ping()
      const redisConfigFinto = { createClient: () => redis } as unknown as RedisConfig
      rateLimiter = new RentriRateLimiterService(redisConfigFinto)
      await rateLimiter.onModuleInit()
    })

    afterAll(async () => {
      await redis.quit()
    })

    it(
      "429 iniettato due volte con Retry-After=5s: il tempo totale resta ~10s (le due attese dell'ente), " +
        'il limitatore preventivo reale (tenant nuovo, ben sotto soglia) non aggiunge attesa propria',
      async () => {
        const client = creaClient({ rateLimiter })
        await impostaGuasto(429, 2)

        const inizio = Date.now()
        const risultato = await client.creaFormulario(
          'r5-task6-step2-non-raddoppiato',
          corpoFormularioValido()
        )
        const durata = Date.now() - inizio

        expect(risultato.transazioneId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        )
        // Le due attese reali di Retry-After (5s ciascuna, imposte
        // dall'ente simulato) dominano il tempo totale: se il limitatore
        // preventivo avesse sommato una propria attesa, il totale
        // supererebbe visibilmente gli ~10s attesi.
        expect(durata).toBeGreaterThanOrEqual(10000)
        expect(durata).toBeLessThan(10700)
      },
      15000
    )
  })

  /**
   * R5 Task 6, Step 3 — 423 iniettato, e la condizione dell'allarme
   * `RentriTenantBandito` (`monitoring/alerts/rentri.yml`) verificata
   * valutando l'espressione PromQL REALE (`increase(...) >= 3`) su un
   * server Prometheus vero che scrape-a un `/metrics` vero prodotto da
   * `MetricsService`, non leggendo `rentriTenantLocked` in memoria.
   *
   * Perché serve un Prometheus vero e non un parsing manuale del testo
   * `/metrics`: `increase()` su una finestra temporale è semantica di
   * Prometheus (richiede almeno due campioni scrape-ati nel tempo, non un
   * singolo valore istantaneo) — verificarla "a mano" leggendo il controtore
   * una sola volta proverebbe solo che una variabile è cambiata, esattamente
   * ciò che il brief chiede di NON fare.
   *
   * Come: (1) un piccolo server HTTP Node espone `MetricsService.getMetrics()`
   * su `/metrics`; (2) un container `prom/prometheus` (immagine reale, non
   * un doppio) scrape-a quel server ogni secondo e carica
   * `monitoring/alerts/rentri.yml` COSÌ COM'È (letto da disco, non
   * riscritto); (3) si genera il traffico reale (423 ripetuto) attraverso il
   * client verso la fake; (4) si interroga l'API HTTP di Prometheus
   * (`/api/v1/query`) con la STESSA espressione della regola.
   *
   * **Limite scoperto qui, non introdotto da questo test**: la regola
   * `RentriTenantBandito` (v. `monitoring/alerts/rentri.yml`) annota
   * `{{ $labels.tenant_id }}`, ma il contatore che interroga
   * (`wasteflow_rentri_api_errors_total`, `MetricsService.rentriApiErrors`)
   * NON porta affatto un'etichetta `tenant_id` (solo `endpoint`/`error_type`
   * — v. `metrics.service.ts` e ogni chiamata a `.inc()` in
   * `rentri-http-resilienza.ts`). Di conseguenza: (a) l'annotazione
   * dell'allarme reale mostrerebbe un `tenant_id` vuoto, non quello del
   * tenant colpito; (b) l'allarme si aggrega su TUTTI i tenant insieme — 423
   * ripetuti su tenant DIVERSI farebbero scattare lo stesso allarme "per lo
   * stesso tenant" che la descrizione promette, cosa che il testo del piano
   * (R5 Task 5) non intende. Non è un difetto di questo task (R5 Task 5 è
   * già chiuso/mergiato): riportato qui perché SOLO valutando l'espressione
   * su un `/metrics` reale con un'etichetta reale questo genere di difetto
   * emerge — un'asserzione sul gauge in memoria non lo avrebbe mai rivelato.
   * Il test sotto verifica quindi la query SENZA filtro `tenant_id` (l'unica
   * che l'implementazione reale supporta), non quella "ideale" che la
   * descrizione della regola lascerebbe intendere.
   */
  describe('R5 Task 6, Step 3 — 423 iniettato: allarme verificato su /metrics reale (Prometheus vero)', () => {
    let metrics: MetricsService
    let metricsServer: http.Server
    let metricsPort: number
    let prometheusContainerName: string
    let prometheusPort: number
    let prometheusDisponibile = true

    async function docker(args: string[]): Promise<void> {
      await execFileAsync('docker', args)
    }

    async function queryPrometheus(query: string): Promise<any> {
      const risposta = await fetch(
        `http://127.0.0.1:${prometheusPort}/api/v1/query?query=${encodeURIComponent(query)}`
      )
      return risposta.json()
    }

    /**
     * Interroga ripetutamente finché `condizione` è soddisfatta o scade il
     * tempo. Necessario perché il tempo tra "il target è /-/ready" e "la
     * prima vera raccolta di campioni utile a `increase()`" NON è costante:
     * dipende dallo scheduling dello scrape manager di Prometheus e dalla
     * risoluzione di `host.docker.internal` dal container, osservato in
     * pratica variare da ~1s a oltre 10s sulla stessa macchina in run
     * consecutivi. Un'attesa fissa singola è quindi intrinsecamente fragile:
     * qui si attende quanto serve DAVVERO, non un numero indovinato.
     */
    async function finoA(
      condizione: () => Promise<any | undefined>,
      timeoutMs: number
    ): Promise<any> {
      const scadenza = Date.now() + timeoutMs
      for (;;) {
        const risultato = await condizione()
        if (risultato !== undefined) return risultato
        if (Date.now() > scadenza) {
          throw new Error(`Condizione non soddisfatta entro ${timeoutMs}ms`)
        }
        await new Promise(r => setTimeout(r, 400))
      }
    }

    beforeAll(async () => {
      metrics = new MetricsService()

      metricsServer = http.createServer((richiesta, risposta) => {
        if (richiesta.url === '/metrics') {
          metrics
            .getMetrics()
            .then(testo => {
              risposta.writeHead(200, { 'Content-Type': 'text/plain' })
              risposta.end(testo)
            })
            .catch(() => {
              risposta.writeHead(500)
              risposta.end()
            })
          return
        }
        risposta.writeHead(404)
        risposta.end()
      })
      await new Promise<void>(resolve => metricsServer.listen(0, '0.0.0.0', () => resolve()))
      metricsPort = (metricsServer.address() as any).port

      prometheusPort = 19100 + (process.pid % 400)
      prometheusContainerName = `rentri-prom-r5t6-${process.pid}`

      const alertsPath = path.resolve(__dirname, '../../../../../monitoring/alerts/rentri.yml')
      const rentriAlertsYaml = fs.readFileSync(alertsPath, 'utf-8')

      const prometheusYaml = [
        'global:',
        '  scrape_interval: 1s',
        '  evaluation_interval: 1s',
        'rule_files:',
        '  - /etc/prometheus/rentri.yml',
        'scrape_configs:',
        '  - job_name: wasteflow-test',
        '    static_configs:',
        `      - targets: ['host.docker.internal:${metricsPort}']`,
        '    metrics_path: /metrics',
        '',
      ].join('\n')

      const b64Prom = Buffer.from(prometheusYaml).toString('base64')
      const b64Alerts = Buffer.from(rentriAlertsYaml).toString('base64')
      const shCmd =
        `echo ${b64Prom} | base64 -d > /etc/prometheus/prometheus.yml && ` +
        `echo ${b64Alerts} | base64 -d > /etc/prometheus/rentri.yml && ` +
        `exec /bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus`

      try {
        await docker([
          'run',
          '-d',
          '--rm',
          '--name',
          prometheusContainerName,
          '-p',
          `${prometheusPort}:9090`,
          // `host.docker.internal` è una comodità di Docker Desktop: su Docker
          // per Linux — quello del runner CI — non esiste, e senza questa
          // riga Prometheus parte, diventa pronto, ma non scrape-a nulla. Il
          // sintomo non è un errore di rete: è l'attesa dell'allarme che scade,
          // che somiglia a un difetto del prodotto e non lo è.
          '--add-host',
          'host.docker.internal:host-gateway',
          '--entrypoint',
          'sh',
          'prom/prometheus:latest',
          '-c',
          shCmd,
        ])

        // Attende che Prometheus sia pronto a servire query (non solo che il
        // container sia partito: /-/ready implica config caricata).
        const scadenza = Date.now() + 15000
        for (;;) {
          try {
            const r = await fetch(`http://127.0.0.1:${prometheusPort}/-/ready`)
            if (r.status === 200) break
          } catch {
            /* non ancora in ascolto */
          }
          if (Date.now() > scadenza) {
            throw new Error('Prometheus di test non è diventato pronto entro 15s')
          }
          await new Promise(r => setTimeout(r, 300))
        }
      } catch (errore) {
        // Ambiente senza Docker raggiungibile: dichiarato esplicitamente,
        // non un'asserzione annacquata — i test sotto si saltano da soli.
        prometheusDisponibile = false
        // eslint-disable-next-line no-console
        console.warn('R5 Task 6 Step 3: Prometheus di test non avviabile, suite saltata.', errore)
      }
    }, 30000)

    afterAll(async () => {
      if (prometheusDisponibile) {
        await docker(['rm', '-f', prometheusContainerName]).catch(() => undefined)
      }
      await new Promise<void>(resolve => metricsServer.close(() => resolve()))
    })

    it(
      "423 iniettato 5 volte (esaurisce la resilienza del client): 'wasteflow_rentri_tenant_locked' " +
        "risulta 1 su /metrics REALE, e l'espressione PromQL dell'allarme " +
        "'increase(wasteflow_rentri_api_errors_total{error_type=\"LOCKED\"}[1h]) >= 3' e' soddisfatta " +
        'interrogando Prometheus vero, non leggendo il gauge in memoria',
      async () => {
        if (!prometheusDisponibile) {
          // eslint-disable-next-line no-console
          console.warn('Skip: Prometheus di test non disponibile in questo ambiente.')
          return
        }

        const client = creaClient({ metrics })
        const tenantId = 'r5-task6-step3-bandito'
        const endpointContesto = '/formulari (crea)'

        // SEED: registra la serie a 0 PRIMA di generare il traffico reale.
        // Necessario per fedeltà a come si comporta DAVVERO `increase()`: un
        // Counter di `prom-client` con etichette non compare nel testo
        // `/metrics` finché non viene incrementato ALMENO una volta — quindi
        // se le 5 risposte 423 fossero le PRIME ad incrementarlo, la serie
        // "nascerebbe" già al valore 5 fra due scrape consecutivi, e
        // `increase()` vedrebbe una serie costante (nessun campione "prima"
        // con cui calcolare una crescita) restituendo 0 indipendentemente
        // da quanto alto sia il contatore — non un bug di Prometheus, è la
        // semantica dichiarata di `increase()` su un range di campioni. In
        // produzione questo non accade mai (il processo gira da ore prima di
        // qualunque incidente, la serie esiste già); qui va simulato
        // esplicitamente incrementando di 0 (`inc(labels, 0)`, API
        // pubblica di `prom-client`, non un trucco nascosto).
        metrics.rentriApiErrors.inc({ endpoint: endpointContesto, error_type: 'LOCKED' }, 0)

        // Attende che Prometheus abbia REALMENTE scrapato il seed a 0
        // (non un'attesa a tempo fisso indovinata, v. `finoA`).
        await finoA(async () => {
          const r = await queryPrometheus(`wasteflow_rentri_api_errors_total{error_type="LOCKED"}`)
          return r.data?.result?.length > 0 ? r : undefined
        }, 20000)

        // 5 = MAX_TENTATIVI_RESILIENZA del client: TUTTI i tentativi vedono
        // 423, l'operazione fallisce definitivamente e il gauge resta a 1
        // (nessun tentativo successivo di successo che lo riporterebbe a 0,
        // v. `post()` in rentri-api.client.ts).
        await impostaGuasto(423, 5)

        // "bandito": il tenant che subisce 5 fallimenti 423 consecutivi
        // (v. RentriApiError.retryable e il gauge rentriTenantLocked sotto).
        await expect(client.creaFormulario(tenantId, corpoFormularioValido())).rejects.toThrow(
          RentriApiError
        )

        const lockedRisposta = await finoA(async () => {
          const r = await queryPrometheus(`wasteflow_rentri_tenant_locked{tenant_id="${tenantId}"}`)
          return r.data?.result?.length > 0 ? r : undefined
        }, 20000)
        expect(lockedRisposta.data.result[0].value[1]).toBe('1')

        // L'esatta espressione della regola (v. commento di testata: senza
        // filtro tenant_id, che il contatore reale non porta).
        const allarmeRisposta = await finoA(async () => {
          const r = await queryPrometheus(
            'increase(wasteflow_rentri_api_errors_total{error_type="LOCKED"}[1h]) >= 3'
          )
          // Un confronto booleano in PromQL restituisce una serie SOLO se la
          // condizione è vera: risultato non vuoto = condizione soddisfatta,
          // esattamente come la valuterebbe il motore di allarme di
          // Prometheus reale (Alertmanager riceverebbe questa stessa serie).
          return r.data?.result?.length > 0 ? r : undefined
        }, 20000)
        expect(allarmeRisposta.status).toBe('success')
        expect(allarmeRisposta.data.result.length).toBeGreaterThan(0)

        const valoreGrezzo = await queryPrometheus(
          'increase(wasteflow_rentri_api_errors_total{error_type="LOCKED"}[1h])'
        )
        // >= 3 (non 5): `increase()` di Prometheus ESTRAPOLA il valore ai
        // bordi della finestra in base al tempo tra i campioni scrape-ati,
        // non conta esattamente gli eventi discreti osservati — su un range
        // corto rispetto allo scrape_interval può restituire un valore
        // frazionario leggermente sotto il conteggio reale (osservato: 5
        // incrementi reali → ~4.07 stimato). La soglia rilevante per
        // l'allarme resta 3 (v. query booleana sopra, quella realmente
        // valutata da Prometheus per decidere se scattare); qui si verifica
        // solo che il valore stimato sia comunque coerente con "molti 423",
        // non un conteggio esatto bit a bit.
        expect(Number(valoreGrezzo.data.result[0].value[1])).toBeGreaterThanOrEqual(3)
      },
      60000
    )
  })
})
