import { RedisConfig } from '../cache/redis.config'
import {
  RentriRateLimiterService,
  RentriRateLimitTimeoutError,
  RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE,
  RENTRI_RATE_LIMIT_FINESTRA_MS,
  RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA,
  RENTRI_RATE_LIMIT_TTL_VOLUME_MS,
  RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS,
  RENTRI_RATE_LIMIT_TIMEOUT_AZIONE_MANUALE_MS,
} from './rentri-rate-limiter.service'

/**
 * Suite UNITARIA (Redis mockato): copre tutto ciò che non è comportamento
 * temporale — costruzione delle chiavi, valore delle costanti/soglie, rami
 * di decisione (concesso/negato/attesa/timeout) — pilotando direttamente il
 * valore restituito dallo script Lua via un doppio di `eval`.
 *
 * Il comportamento REALMENTE temporale (la finestra che scorre, il quarto
 * che attende il rilascio di uno dei tre) richiede un Redis vero e vive in
 * `rentri-rate-limiter.redis.spec.ts` (eseguita da `npm run test:redis`,
 * NON da questa suite — v. commento in `jest.config.js`).
 */
describe('RentriRateLimiterService', () => {
  let evalMock: jest.Mock
  let zremMock: jest.Mock
  let service: RentriRateLimiterService

  beforeEach(async () => {
    evalMock = jest.fn()
    zremMock = jest.fn().mockResolvedValue(1)

    const redisFinto = {
      eval: evalMock,
      zrem: zremMock,
      on: jest.fn(),
    }

    const redisConfig = {
      createClient: () => redisFinto,
    } as unknown as RedisConfig

    service = new RentriRateLimiterService(redisConfig)
    await service.onModuleInit()
  })

  describe('costanti esportate', () => {
    it('rispetta i valori decisi nel brief R5 (task 1)', () => {
      expect(RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE).toBe(30)
      expect(RENTRI_RATE_LIMIT_FINESTRA_MS).toBe(5000)
      expect(RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA).toBe(3)
      expect(RENTRI_RATE_LIMIT_TIMEOUT_AZIONE_MANUALE_MS).toBe(2000)
    })

    it('la soglia di volume è il 30% del limite contrattuale (100/5s)', () => {
      expect(RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE / 100).toBeCloseTo(0.3)
    })

    it('il TTL di garbage-collection del volume è maggiore della finestra stessa', () => {
      expect(RENTRI_RATE_LIMIT_TTL_VOLUME_MS).toBeGreaterThan(RENTRI_RATE_LIMIT_FINESTRA_MS)
    })

    it('il TTL di sicurezza della concorrenza è ampiamente sopra al backoff massimo del client (30s)', () => {
      expect(RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS).toBeGreaterThan(30000)
    })
  })

  describe('costruzione delle chiavi', () => {
    it('espone le chiavi nel formato rentri:ratelimit:{tenantId} e rentri:concurrency:{tenantId}', () => {
      expect(service.getChiaveVolume('tenant-abc')).toBe('rentri:ratelimit:tenant-abc')
      expect(service.getChiaveConcorrenza('tenant-abc')).toBe('rentri:concurrency:tenant-abc')
    })

    it('usa chiavi diverse per tenant diversi (isolamento — il ban colpisce il certificato del singolo tenant)', () => {
      expect(service.getChiaveVolume('tenant-a')).not.toBe(service.getChiaveVolume('tenant-b'))
      expect(service.getChiaveConcorrenza('tenant-a')).not.toBe(
        service.getChiaveConcorrenza('tenant-b')
      )
    })

    it("passa a EVAL esattamente le due chiavi del tenant richiesto, nell'ordine volume poi concorrenza", async () => {
      evalMock.mockResolvedValue(1)
      await service.acquisisci('tenant-xyz')

      expect(evalMock).toHaveBeenCalledWith(
        expect.any(String),
        2,
        'rentri:ratelimit:tenant-xyz',
        'rentri:concurrency:tenant-xyz',
        expect.any(Number),
        RENTRI_RATE_LIMIT_FINESTRA_MS,
        RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE,
        RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS,
        RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA,
        RENTRI_RATE_LIMIT_TTL_VOLUME_MS,
        expect.any(String)
      )
    })
  })

  describe('ramo: capacità concessa subito', () => {
    it('restituisce un permesso con rilascia() al primo tentativo se EVAL risponde 1', async () => {
      evalMock.mockResolvedValue(1)

      const permesso = await service.acquisisci('tenant-1')

      expect(permesso).toHaveProperty('rilascia')
      expect(typeof permesso.rilascia).toBe('function')
      expect(evalMock).toHaveBeenCalledTimes(1)
    })

    it('rilascia() rimuove dalla concorrenza il token generato per QUELLA acquisizione, via ZREM', async () => {
      evalMock.mockResolvedValue(1)

      const permesso = await service.acquisisci('tenant-1')
      await permesso.rilascia()

      expect(zremMock).toHaveBeenCalledTimes(1)
      expect(zremMock).toHaveBeenCalledWith('rentri:concurrency:tenant-1', expect.any(String))
    })
  })

  describe('ramo: capacità non disponibile, poi liberata (nessun timeout — chiamante automatico)', () => {
    it('ripete il tentativo con polling finché EVAL non risponde 1, senza mai lanciare', async () => {
      evalMock.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1)

      const permesso = await service.acquisisci('tenant-1')

      expect(evalMock).toHaveBeenCalledTimes(3)
      expect(permesso).toHaveProperty('rilascia')
    })

    it('un job automatico (nessun timeoutMs) continua ad attendere anche oltre il tetto interattivo di 2s', async () => {
      let chiamate = 0
      evalMock.mockImplementation(() => {
        chiamate += 1
        return Promise.resolve(chiamate >= 6 ? 1 : 0)
      })

      const permesso = await service.acquisisci('tenant-1')

      expect(chiamate).toBe(6)
      expect(permesso).toHaveProperty('rilascia')
    })
  })

  describe("ramo: timeout per l'azione interattiva dell'utente", () => {
    it('lancia RentriRateLimitTimeoutError se la capacità non si libera entro timeoutMs', async () => {
      evalMock.mockResolvedValue(0)

      await expect(service.acquisisci('tenant-1', { timeoutMs: 120 })).rejects.toBeInstanceOf(
        RentriRateLimitTimeoutError
      )
    })

    it("l'errore riporta tenantId e timeoutMs per costruire il messaggio utente a valle", async () => {
      evalMock.mockResolvedValue(0)

      await expect(service.acquisisci('tenant-9', { timeoutMs: 120 })).rejects.toMatchObject({
        tenantId: 'tenant-9',
        timeoutMs: 120,
      })
    })

    it('non lancia se la capacità si libera appena prima della scadenza del timeout', async () => {
      evalMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

      const permesso = await service.acquisisci('tenant-1', { timeoutMs: 5000 })

      expect(permesso).toHaveProperty('rilascia')
    })
  })

  describe('statoAttuale — lettura per la diagnostica (R5 Task 3)', () => {
    it('restituisce volume/concorrenza correnti e inAttesa=false sotto soglia', async () => {
      evalMock.mockResolvedValue([5, 1])

      const stato = await service.statoAttuale('tenant-1')

      expect(stato).toEqual({ volumeCorrente: 5, concorrenzaCorrente: 1, inAttesa: false })
    })

    it('inAttesa=true quando il volume ha raggiunto la soglia (30)', async () => {
      evalMock.mockResolvedValue([RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE, 0])

      const stato = await service.statoAttuale('tenant-1')

      expect(stato.inAttesa).toBe(true)
    })

    it('inAttesa=true quando la concorrenza ha raggiunto il massimo (3)', async () => {
      evalMock.mockResolvedValue([0, RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA])

      const stato = await service.statoAttuale('tenant-1')

      expect(stato.inAttesa).toBe(true)
    })

    it('NON scrive nulla (nessun ZADD): è una lettura, non deve consumare budget', async () => {
      evalMock.mockResolvedValue([0, 0])

      await service.statoAttuale('tenant-1')

      // L'unica interazione con Redis è l'EVAL di sola lettura: nessun ZADD
      // separato, nessuna chiamata aggiuntiva che scriverebbe uno slot.
      expect(evalMock).toHaveBeenCalledTimes(1)
    })

    it('interroga le chiavi del tenant richiesto, isolate dagli altri tenant', async () => {
      evalMock.mockResolvedValue([0, 0])

      await service.statoAttuale('tenant-isolato')

      expect(evalMock).toHaveBeenCalledWith(
        expect.any(String),
        2,
        'rentri:ratelimit:tenant-isolato',
        'rentri:concurrency:tenant-isolato',
        expect.any(Number),
        RENTRI_RATE_LIMIT_FINESTRA_MS,
        RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS
      )
    })
  })
})
