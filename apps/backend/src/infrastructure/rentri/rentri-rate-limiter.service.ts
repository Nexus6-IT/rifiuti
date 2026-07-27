import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Redis, Cluster } from 'ioredis'
import { RedisConfig } from '../cache/redis.config'

/**
 * Terzo strato di resilienza verso RENTRI (R5, task 1) — PREVENTIVO, a
 * differenza dei due strati già esistenti:
 * - `rentri-http-resilienza.ts` / `RENTRIApiClient` reagiscono a un errore
 *   già ricevuto (403/429/423/5xx) con backoff e ritentativi;
 * - lo stato di dominio con backoff reagisce anch'esso a un fallimento
 *   avvenuto.
 *
 * Questo servizio invece EVITA di avvicinarsi alla soglia dichiarata dal
 * contratto RENTRI (100 richieste/5s → 429; troppe richieste concorrenti
 * non valide → 423) prima ancora che una richiesta parta. Il 423 colpisce
 * il certificato del singolo tenant chiamante, quindi il limite DEVE essere
 * per-tenant — un contatore globale proteggerebbe il tenant sbagliato e
 * lascerebbe che uno solo esaurisca la soglia di tutti gli altri.
 *
 * Cablaggio nel client (`RENTRIApiClient`) NON è in questo task — è il
 * Task 2 del piano R5. Qui si consegna solo il servizio, testato in
 * isolamento, con un'API che permette al Task 2 di avvolgere ogni chiamata
 * uscente in `acquisisci()`/`rilascia()` senza altre modifiche strutturali.
 */

/** Soglia di volume: 30 richieste ogni 5 secondi per tenant.
 *
 * Il 30% del limite dichiarato dal contratto (100 richieste/5s). Il margine
 * (70%) non è prudenza generica: copre tre rischi concreti e concorrenti,
 * nessuno dei quali visibile lato nostro finché non si materializza come
 * 429/423:
 * (a) l'allineamento della finestra è dell'ente e non è noto — la nostra
 *     finestra scorrevole non misura necessariamente la stessa finestra
 *     fisica osservata da RENTRI, quindi un uso "a 100 esatti" secondo i
 *     nostri orologi può risultare sforato secondo i suoi;
 * (b) un operatore dell'azienda può usare il portale RENTRI in parallelo
 *     alla nostra automazione con lo stesso certificato — traffico
 *     completamente invisibile a questo servizio;
 * (c) una singola operazione di dominio può già consumare fino a 5
 *     richieste HTTP per via della resilienza del client
 *     (`RENTRIApiClient.MAX_TENTATIVI_RESILIENZA`) quando l'ente è
 *     degradato — è esattamente in quel momento che NON bisogna aggiungere
 *     pressione con nuovo traffico.
 */
export const RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE = 30

/** Ampiezza della finestra scorrevole di volume, in millisecondi (5s, come il contratto RENTRI). */
export const RENTRI_RATE_LIMIT_FINESTRA_MS = 5000

/**
 * Concorrenza massima: 3 richieste in volo per tenant.
 *
 * Il contratto lega esplicitamente il 423 a "un numero eccessivo di
 * richieste CONCORRENTI, autenticate ma non valide" — un asse distinto dal
 * volume, che nessuno dei due strati esistenti limita (il polling di
 * `attendiEsito` è già sequenziale per una singola transazione, ma nulla
 * impedisce a più job BullMQ dello stesso tenant di essere processati in
 * parallelo da worker diversi). Tre è il numero minimo che non serializza
 * inutilmente le operazioni legittime (dettaglio + polling stato + polling
 * risultato possono sovrapporsi per FIR diversi dello stesso tenant)
 * restando ben sotto qualunque soglia realistica di "troppe".
 */
export const RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA = 3

/**
 * TTL (ms) della chiave Redis del volume (sorted set), non della logica di
 * conteggio. Serve SOLO a far scomparire dalla memoria di Redis la chiave
 * di un tenant diventato inattivo — non partecipa alla decisione di
 * concedere o negare capacità (quella la fa sempre `ZREMRANGEBYSCORE` sulla
 * finestra dei 5s ad ogni controllo). Impostarlo poco sopra la finestra
 * (5s) è sicuro qui, a differenza della concorrenza sotto: se la chiave
 * resta senza scritture per 10s, la finestra di 5s che dovrebbe proteggere
 * è comunque già logicamente vuota da tempo, quindi il TTL non azzera mai
 * uno stato che sarebbe stato considerato ancora valido.
 */
export const RENTRI_RATE_LIMIT_TTL_VOLUME_MS = 10000

/**
 * Soglia di età (ms) oltre la quale un token di concorrenza è considerato
 * orfano e viene potato — rete di sicurezza per un processo morto senza
 * mai chiamare `rilascia()` (crash, kill -9, riavvio del worker).
 *
 * NON è un TTL sull'intera chiave Redis (come sarebbe con un
 * INCR/DECR+EXPIRE): un TTL a livello di chiave, se non rinnovato,
 * scadrebbe portando il contatore a un valore fantasma "resettato" mentre
 * ci sono ancora slot legittimamente occupati sotto carico continuo —
 * esattamente il difetto che lo sliding-window-log evita già per il volume
 * (vedi sopra "un bordo fisso permetterebbe una raffica doppia"). Per la
 * concorrenza il rischio è più serio che per il volume, perché uno slot
 * legittimo può restare occupato per la durata reale di una chiamata HTTP
 * lenta, non per una finestra fissa di 5s: una singola chiave con TTL
 * unico costringerebbe a scegliere fra "rinnovare ad ogni INCR" (e allora
 * uno slot davvero orfano non scade mai finché arriva altro traffico che
 * rinnova la chiave) o "impostarlo una sola volta" (e allora una richiesta
 * lenta ma legittima può vedersi azzerato il contatore a metà).
 *
 * La soluzione qui adottata evita il dilemma: la concorrenza è tracciata
 * come uno sliding-window-log (sorted set), non come un intero — ogni
 * acquisizione aggiunge un token con punteggio = timestamp di acquisizione;
 * `rilascia()` rimuove il proprio token con `ZREM` non appena la chiamata
 * termina; un token il cui timestamp supera questa soglia viene comunque
 * potato ad ogni controllo con `ZREMRANGEBYSCORE`, indipendentemente dagli
 * altri. Cosi uno slot orfano scade da solo entro questa soglia SENZA
 * toccare gli altri slot attivi, e uno slot legittimo che dura più a lungo
 * del previsto non viene mai azzerato "per sbaglio" insieme agli altri.
 * 60s è più che sufficiente per qualunque chiamata RENTRI legittima (anche
 * con backoff di resilienza, `RENTRIApiClient.BACKOFF_MAX_MS` è 30s) pur
 * restando un tempo di recupero contenuto per uno slot davvero orfano.
 */
export const RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS = 60000

/** Intervallo (ms) di polling mentre si attende che si liberi capacità. Breve
 * abbastanza da non introdurre latenza percepibile una volta libera la
 * capacità, largo abbastanza da non martellare Redis con `EVAL` inutili. */
export const RENTRI_RATE_LIMIT_INTERVALLO_POLLING_MS = 75

/**
 * Tetto di attesa (ms) per l'azione manuale dell'utente ("Trasmetti a
 * RENTRI"): oltre questo tempo, l'attesa cessa e viene sollevato
 * {@link RentriRateLimitTimeoutError} invece di bloccare a tempo
 * indeterminato la richiesta HTTP dell'utente. Il chiamante automatico
 * (job in coda) invece NON passa un timeout a `acquisisci()` e attende
 * finché serve: per un job in background, aspettare la capacità è il
 * comportamento corretto, non un errore da mostrare a nessuno.
 * Il testo del messaggio utente ("troppe richieste verso RENTRI in questo
 * momento, riprova tra poco") è fuori scope qui — è il Task che cablerà
 * questo servizio nell'endpoint interattivo a tradurre l'eccezione in
 * risposta HTTP leggibile.
 */
export const RENTRI_RATE_LIMIT_TIMEOUT_AZIONE_MANUALE_MS = 2000

/**
 * Sollevato da `acquisisci()` quando è stato specificato un `timeoutMs` e
 * la capacità non si è liberata entro quel tempo. Tipizzato (non un
 * generico `Error`) perché il chiamante interattivo deve poterlo
 * distinguere da un errore imprevisto e tradurlo nel messaggio utente
 * previsto dal brief, senza ispezionare stringhe.
 */
export class RentriRateLimitTimeoutError extends Error {
  constructor(
    readonly tenantId: string,
    readonly timeoutMs: number
  ) {
    super(
      `Capacità RENTRI non disponibile per il tenant ${tenantId} entro ${timeoutMs}ms: troppe richieste verso RENTRI in questo momento.`
    )
    this.name = 'RentriRateLimitTimeoutError'
  }
}

/** Permesso restituito da `acquisisci()`. `rilascia()` va SEMPRE chiamato in
 * un blocco `finally` dal chiamante (verificato dal Task 2, non da questo
 * servizio) — se non viene mai chiamato, lo slot di concorrenza resta
 * occupato fino alla potatura per età (v. `RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS`). */
export interface PermessoRentri {
  rilascia(): Promise<void>
}

/**
 * Script Lua eseguito atomicamente da Redis (single-thread: nessun altro
 * comando si intromette a metà esecuzione). Necessario perché il controllo
 * "c'è ancora budget?" e la scrittura "registra questo uso" NON possono
 * essere due comandi separati: fra i due comandi un altro worker dello
 * stesso tenant potrebbe leggere lo stesso stato "ancora libero" e superare
 * comunque la soglia — esattamente il tipo di corsa che l'asse di
 * concorrenza (l'altro axis di questo limitatore) dovrebbe prevenire, non
 * introdurre.
 *
 * KEYS[1] = chiave volume (sorted set, punteggio = timestamp ms)
 * KEYS[2] = chiave concorrenza (sorted set, punteggio = timestamp ms di acquisizione)
 * ARGV[1] = now (ms)
 * ARGV[2] = finestra volume (ms)
 * ARGV[3] = soglia volume
 * ARGV[4] = soglia età concorrenza (ms) — token più vecchi vengono potati
 * ARGV[5] = concorrenza massima
 * ARGV[6] = TTL della chiave volume (ms) — solo garbage collection, v. sopra
 * ARGV[7] = token univoco di questa acquisizione
 *
 * Ritorna 1 se concesso (ed effettua la scrittura), 0 se negato (nessuna
 * scrittura: un tentativo negato non deve consumare budget).
 */
const LUA_ACQUISISCI = `
local now = tonumber(ARGV[1])
local finestraMs = tonumber(ARGV[2])
local sogliaVolume = tonumber(ARGV[3])
local sogliaEtaConcorrenza = tonumber(ARGV[4])
local concorrenzaMax = tonumber(ARGV[5])
local ttlVolumeMs = tonumber(ARGV[6])
local token = ARGV[7]

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - finestraMs)
local volumeCorrente = redis.call('ZCARD', KEYS[1])
if volumeCorrente >= sogliaVolume then
  return 0
end

redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now - sogliaEtaConcorrenza)
local concorrenzaCorrente = redis.call('ZCARD', KEYS[2])
if concorrenzaCorrente >= concorrenzaMax then
  return 0
end

redis.call('ZADD', KEYS[1], now, token .. ':v')
redis.call('PEXPIRE', KEYS[1], ttlVolumeMs)
redis.call('ZADD', KEYS[2], now, token)

return 1
`

/**
 * Script Lua di SOLA LETTURA (nessun `ZADD`, nessuna scrittura di un nuovo
 * slot): usato da `statoAttuale()` per la diagnostica (R5 Task 3) — mostrare
 * all'utente "RENTRI sta ricevendo molte richieste in questo momento" NON
 * deve consumare capacità che un'operazione reale userebbe, altrimenti la
 * sola apertura della pagina di diagnostica renderebbe il limitatore più
 * severo. La potatura (`ZREMRANGEBYSCORE`) resta necessaria anche qui: senza,
 * un `ZCARD` letto a freddo conterebbe anche slot già scaduti per finestra
 * scorsa o età, sovrastimando l'attesa e mostrando un allarme falso.
 *
 * KEYS[1] = chiave volume, KEYS[2] = chiave concorrenza
 * ARGV[1] = now (ms), ARGV[2] = finestra volume (ms), ARGV[3] = soglia età concorrenza (ms)
 * Ritorna {volumeCorrente, concorrenzaCorrente}.
 */
const LUA_STATO_ATTUALE = `
local now = tonumber(ARGV[1])
local finestraMs = tonumber(ARGV[2])
local sogliaEtaConcorrenza = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - finestraMs)
local volumeCorrente = redis.call('ZCARD', KEYS[1])

redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now - sogliaEtaConcorrenza)
local concorrenzaCorrente = redis.call('ZCARD', KEYS[2])

return {volumeCorrente, concorrenzaCorrente}
`

/**
 * Stato del limitatore per un tenant, in un dato istante: quante richieste
 * ha in finestra e quante in volo, e se — in QUESTO momento — un'operazione
 * nuova dovrebbe attendere. Sola lettura verso Redis (infrastruttura
 * locale): non genera alcuna chiamata verso RENTRI, adatto ad essere
 * interrogato ad ogni caricamento di una pagina di diagnostica (R5 Task 3)
 * senza che questo aggiunga traffico verso l'ente.
 */
export interface StatoLimitatoreRentri {
  volumeCorrente: number
  concorrenzaCorrente: number
  /** true se volume o concorrenza sono già alla soglia: una nuova richiesta di questo tenant attenderebbe. */
  inAttesa: boolean
}

@Injectable()
export class RentriRateLimiterService implements OnModuleInit {
  private readonly logger = new Logger(RentriRateLimiterService.name)
  private redis: Redis | Cluster

  constructor(private readonly redisConfig: RedisConfig) {}

  async onModuleInit(): Promise<void> {
    this.redis = this.redisConfig.createClient()

    this.redis.on('connect', () => {
      this.logger.log('Redis connesso per il rate limiter preventivo RENTRI')
    })

    this.redis.on('error', error => {
      this.logger.error('Errore di connessione Redis (rate limiter RENTRI):', error)
    })
  }

  /** Chiave del sorted set di volume per il tenant (sliding window log, 5s). */
  getChiaveVolume(tenantId: string): string {
    return `rentri:ratelimit:${tenantId}`
  }

  /** Chiave del sorted set di concorrenza per il tenant. */
  getChiaveConcorrenza(tenantId: string): string {
    return `rentri:concurrency:${tenantId}`
  }

  /**
   * Attende (se necessario) e acquisisce capacità per il tenant, restituendo
   * un permesso con `rilascia()`.
   *
   * - Senza `opzioni.timeoutMs`: attende indefinitamente, polling ogni
   *   {@link RENTRI_RATE_LIMIT_INTERVALLO_POLLING_MS}. Uso previsto: job
   *   automatici in coda (BullMQ), per cui attendere è il comportamento
   *   corretto.
   * - Con `opzioni.timeoutMs`: se la capacità non si libera entro quel
   *   tempo, solleva {@link RentriRateLimitTimeoutError} invece di
   *   continuare ad attendere. Uso previsto: azione interattiva dell'utente,
   *   con {@link RENTRI_RATE_LIMIT_TIMEOUT_AZIONE_MANUALE_MS} come tetto
   *   consigliato dal brief.
   */
  async acquisisci(tenantId: string, opzioni?: { timeoutMs?: number }): Promise<PermessoRentri> {
    const timeoutMs = opzioni?.timeoutMs
    const scadenza = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined

    for (;;) {
      const token = await this.provaAcquisire(tenantId)
      if (token !== null) {
        return {
          rilascia: () => this.rilascia(tenantId, token),
        }
      }

      if (scadenza !== undefined && Date.now() >= scadenza) {
        throw new RentriRateLimitTimeoutError(tenantId, timeoutMs as number)
      }

      await this.attendi(RENTRI_RATE_LIMIT_INTERVALLO_POLLING_MS)
    }
  }

  /**
   * Un solo tentativo, atomico, di acquisizione. Restituisce il token
   * generato (da passare a `rilascia()`) se concesso, `null` se negato.
   */
  private async provaAcquisire(tenantId: string): Promise<string | null> {
    const now = Date.now()
    const token = `${now}-${randomUUID()}`

    const risultato = await this.redis.eval(
      LUA_ACQUISISCI,
      2,
      this.getChiaveVolume(tenantId),
      this.getChiaveConcorrenza(tenantId),
      now,
      RENTRI_RATE_LIMIT_FINESTRA_MS,
      RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE,
      RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS,
      RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA,
      RENTRI_RATE_LIMIT_TTL_VOLUME_MS,
      token
    )

    return Number(risultato) === 1 ? token : null
  }

  /** Libera lo slot di concorrenza identificato da `token`. Idempotente: se il
   * token è già stato potato per età (processo morto, v. TTL sopra), `ZREM`
   * su un membro assente è un no-op innocuo. */
  private async rilascia(tenantId: string, token: string): Promise<void> {
    await this.redis.zrem(this.getChiaveConcorrenza(tenantId), token)
  }

  private attendi(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Legge lo stato corrente del limitatore per il tenant, senza acquisire
   * capacità (nessuna scrittura di un nuovo slot — v. {@link LUA_STATO_ATTUALE}).
   * Uso previsto: la diagnostica RENTRI (R5 Task 3), per spiegare all'utente
   * un rallentamento («RENTRI sta ricevendo molte richieste in questo
   * momento») invece di lasciarlo credere a un guasto.
   */
  async statoAttuale(tenantId: string): Promise<StatoLimitatoreRentri> {
    const now = Date.now()
    const risultato = (await this.redis.eval(
      LUA_STATO_ATTUALE,
      2,
      this.getChiaveVolume(tenantId),
      this.getChiaveConcorrenza(tenantId),
      now,
      RENTRI_RATE_LIMIT_FINESTRA_MS,
      RENTRI_RATE_LIMIT_TTL_CONCORRENZA_MS
    )) as [number | string, number | string]

    const volumeCorrente = Number(risultato[0])
    const concorrenzaCorrente = Number(risultato[1])

    return {
      volumeCorrente,
      concorrenzaCorrente,
      inAttesa:
        volumeCorrente >= RENTRI_RATE_LIMIT_SOGLIA_RICHIESTE ||
        concorrenzaCorrente >= RENTRI_RATE_LIMIT_CONCORRENZA_MASSIMA,
    }
  }
}
