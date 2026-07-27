import Redis from 'ioredis'
import { RedisConfig } from '../cache/redis.config'
import {
  RentriRateLimiterService,
  RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE,
  RENTRI_RATE_LIMIT_FINESTRA_MS,
} from './rentri-rate-limiter.service'

/**
 * Suite di INTEGRAZIONE contro un Redis reale (non mockato): il
 * comportamento sotto test è temporale (una finestra che scorre nel tempo,
 * un'attesa che si risolve quando un altro processo rilascia uno slot) — un
 * mock nasconderebbe esattamente i bug di corsa che questo servizio esiste
 * per evitare. Per lo stesso motivo di `*.postgres.spec.ts`, in CI non
 * esiste un Redis raggiungibile: questa suite fallirebbe per assenza di
 * infrastruttura e bloccherebbe il gate. Resta ESCLUSA dalla suite unitaria
 * (v. `jest.config.js`) ed eseguita con `npm run test:redis` avendo un
 * Redis reale raggiungibile.
 *
 * Redis di test: avviare con
 *   docker run -d --rm --name redis-r5-test -p 16399:6379 redis:7-alpine
 * (porta non standard per non collidere con istanze già attive), fermare a
 * fine sessione con `docker stop redis-r5-test`.
 */
const REDIS_HOST = process.env.RENTRI_RATELIMIT_TEST_REDIS_HOST ?? '127.0.0.1'
const REDIS_PORT = Number(process.env.RENTRI_RATELIMIT_TEST_REDIS_PORT ?? 16399)

describe('RentriRateLimiterService — comportamento temporale su Redis reale', () => {
  let redis: Redis
  let service: RentriRateLimiterService
  let contatoreTenant = 0

  const nuovoTenant = () => {
    contatoreTenant += 1
    return `r5-task1-test-${process.pid}-${contatoreTenant}`
  }

  beforeAll(async () => {
    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: 1 })
    await redis.ping()

    const redisConfigFinto = { createClient: () => redis } as unknown as RedisConfig
    service = new RentriRateLimiterService(redisConfigFinto)
    await service.onModuleInit()
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('sotto soglia: concede subito senza attesa', async () => {
    const tenantId = nuovoTenant()

    const inizio = Date.now()
    const permesso = await service.acquisisci(tenantId, { timeoutMs: 500 })
    const durata = Date.now() - inizio

    expect(permesso).toHaveProperty('rilascia')
    expect(durata).toBeLessThan(200)

    await permesso.rilascia()
  })

  it(
    'a soglia di volume raggiunta: la richiesta successiva attende (non fallisce a valle) finché la finestra non scorre',
    async () => {
      const tenantId = nuovoTenant()

      // Satura il budget di volume (30 richieste/5s), rilasciando subito la
      // concorrenza ad ogni giro per isolare l'asse "volume" da quello
      // "concorrenza".
      for (let i = 0; i < RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE; i++) {
        const permesso = await service.acquisisci(tenantId, { timeoutMs: 500 })
        await permesso.rilascia()
      }

      // La richiesta numero 31 non ha più budget nella finestra corrente:
      // con un timeout breve deve rifiutarsi di attendere indefinitamente,
      // NON generare un errore RENTRI vero.
      const inizio = Date.now()
      await expect(service.acquisisci(tenantId, { timeoutMs: 300 })).rejects.toThrow()
      expect(Date.now() - inizio).toBeGreaterThanOrEqual(300)

      // Trascorsa la finestra intera, la capacità torna disponibile: la
      // finestra scorre, non si azzera a bordo fisso.
      await new Promise(resolve => setTimeout(resolve, RENTRI_RATE_LIMIT_FINESTRA_MS + 200))

      const permessoDopoAttesa = await service.acquisisci(tenantId, { timeoutMs: 500 })
      expect(permessoDopoAttesa).toHaveProperty('rilascia')
      await permessoDopoAttesa.rilascia()
    },
    RENTRI_RATE_LIMIT_FINESTRA_MS + 5000
  )

  it('concorrenza massima 3: il quarto attende il rilascio esplicito di uno dei tre in volo', async () => {
    const tenantId = nuovoTenant()

    const permessi = await Promise.all([
      service.acquisisci(tenantId, { timeoutMs: 500 }),
      service.acquisisci(tenantId, { timeoutMs: 500 }),
      service.acquisisci(tenantId, { timeoutMs: 500 }),
    ])

    let quartoConcesso = false
    const quartaAcquisizione = service.acquisisci(tenantId).then(permesso => {
      quartoConcesso = true
      return permesso
    })

    // Con tre slot occupati, il quarto non deve risolversi finché non
    // liberiamo esplicitamente uno slot: verifichiamo che sia ancora in
    // attesa dopo un tempo ragionevole (ben oltre l'intervallo di polling).
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(quartoConcesso).toBe(false)

    await permessi[0].rilascia()
    const quartoPermesso = await quartaAcquisizione

    expect(quartoConcesso).toBe(true)
    expect(quartoPermesso).toHaveProperty('rilascia')

    await quartoPermesso.rilascia()
    await permessi[1].rilascia()
    await permessi[2].rilascia()
  })

  it('un token di concorrenza orfano (mai rilasciato) libera comunque lo slot dopo la potatura per età', async () => {
    // Simula un processo morto: satura la concorrenza scrivendo
    // direttamente un token "vecchio" nel sorted set di concorrenza, con
    // punteggio già oltre la soglia di età — deve essere trattato come già
    // scaduto dal prossimo controllo, senza attendere l'intero TTL reale.
    const tenantId = nuovoTenant()
    const chiaveConcorrenza = service.getChiaveConcorrenza(tenantId)

    const etaOrfana = Date.now() - 61000 // oltre RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS (60s)
    await redis.zadd(chiaveConcorrenza, etaOrfana, 'token-di-un-processo-morto')

    // Nonostante il token orfano occupi (sulla carta) uno slot, viene
    // potato per età al primo controllo: la capacità resta disponibile.
    const permesso = await service.acquisisci(tenantId, { timeoutMs: 500 })
    expect(permesso).toHaveProperty('rilascia')

    await permesso.rilascia()
  })
})
