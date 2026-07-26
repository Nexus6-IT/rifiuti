import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { LoggerService } from '../../../core/logger/logger.service'
import { MetricsService } from '../../../core/metrics/metrics.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from '../rentri-config'
import { RentriAuthService } from '../rentri-auth.service'
import { gestisciRispostaErroreRentri, attendiMs } from '../rentri-http-resilienza'
import {
  CodificaItem,
  FiltriCodiciEer,
  FiltriComuniProvincia,
  NOME_TABELLE_CODIFICHE_SEMPLICI,
  NomeTabellaCodificaSemplice,
  StatoServizioCodifiche,
} from './rentri-codifiche.model'

/**
 * Client del servizio `codifiche` di RENTRI (`docs/contracts/rentri/codifiche.yaml`,
 * 25 path, tutti `GET`, tutti sola lettura — nessuna scrittura, nessun ciclo
 * asincrono 202/303: sono letture sincrone, non passano dal NONBLOCK_PULL di
 * `formulari`).
 *
 * Riusa i meccanismi già maturati in {@link RENTRIApiClient}
 * (`../rentri-api.client.ts`) invece di duplicarli:
 * - autenticazione ID_AUTH_REST_02 tramite {@link RentriAuthService} (stesso
 *   servizio, stesso JWT self-issued firmato a ogni richiesta — qui non serve
 *   la firma di integrità `Agid-JWT-Signature`, riservata alle richieste con
 *   body, e queste sono tutte `GET`);
 * - classificazione/backoff degli errori tramite le funzioni condivise di
 *   `../rentri-http-resilienza.ts` (403 mai ritentato, 429/423/5xx con
 *   backoff esponenziale o `Retry-After`).
 *
 * **Rate limiting — perché e quanto.** RENTRI risponde 429 oltre 100
 * richieste in 5 secondi (20 richieste/secondo) e può arrivare a bandire
 * (423) chi insiste con richieste non valide. Scaricare le tabelle di
 * codifiche complete (v. {@link scaricaTutte}) è l'operazione più pesante
 * del programma per numero di chiamate in un colpo solo: 23 `GET`
 * sequenziali (le 21 tabelle "semplici" + `codici-eer` + `comuni` — `status`
 * non è una tabella di dati e `comuni/{provincia_id}` è un lookup mirato per
 * singola provincia, non parte del download completo). Anche 23 richieste
 * in burst resterebbero sotto la soglia nominale, ma un burst non è mai
 * giustificato per dati che cambiano a mesi di distanza (v. piano R4, Task
 * 4 Step 5): la strategia scelta è quindi **concorrenza 1** (mai un
 * ventaglio parallelo — {@link scaricaTutte} chiama `await` una tabella
 * alla volta, non `Promise.all`) **più una pausa minima di
 * {@link INTERVALLO_MINIMO_TRA_RICHIESTE_MS} (250 ms)** tra una richiesta e
 * la successiva. Questo limita il throughput teorico a 4 richieste/secondo,
 * un quinto della soglia nota (20/s): un intero ciclo di 23 tabelle impiega
 * quindi ~5,75s di sole pause (più la latenza di rete), un costo trascurabile
 * per un'operazione mensile, con un margine di sicurezza ampio anche
 * sommando eventuali ritentativi di resilienza su singole tabelle.
 */
@Injectable()
export class RentriCodificheClient {
  private readonly timeout = 30000 // 30s

  /**
   * Path base del servizio `codifiche` v1.0, confermato da
   * `docs/contracts/rentri/codifiche.yaml` (`servers[0].url`). Va concatenato
   * a `config.baseUrl` (solo host, es. `https://demoapi.rentri.gov.it`).
   */
  private static readonly CODIFICHE_PATH = '/codifiche/v1.0'

  /** Numero massimo di tentativi per gli errori transitori (429/423/5xx), stesso valore di RENTRIApiClient. */
  private static readonly MAX_TENTATIVI_RESILIENZA = 5

  /** Base (ms) del backoff esponenziale quando l'ente non indica `Retry-After`. */
  private static readonly BACKOFF_BASE_MS = 1000

  /** Tetto (ms) del backoff esponenziale, per non attendere indefinitamente. */
  private static readonly BACKOFF_MAX_MS = 30000

  /**
   * Pausa minima (ms) tra una richiesta `GET` e la successiva quando si
   * scaricano più tabelle in sequenza ({@link scaricaTutte}). V. il
   * commento di testata della classe per la motivazione numerica completa:
   * 250ms → max 4 richieste/secondo, un quinto della soglia nota di RENTRI
   * (100 richieste/5s = 20/s).
   */
  private static readonly INTERVALLO_MINIMO_TRA_RICHIESTE_MS = 250

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly auth: RentriAuthService
  ) {
    this.logger.setContext('RentriCodificheClient')
  }

  /**
   * Legge una delle 21 tabelle "semplici" (`GET /lookup/<nomeTabella>`,
   * nessun filtro dichiarato dal contratto per queste tabelle).
   */
  async leggiTabella(
    nomeTabella: NomeTabellaCodificaSemplice,
    tenantId?: string
  ): Promise<CodificaItem[]> {
    const contesto = `/lookup/${nomeTabella}`
    const response = await this.get(
      `${RentriCodificheClient.CODIFICHE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /lookup/codici-eer` (codifiche.yaml righe 245-293): unica tabella
   * "Rifiuto" con filtri propri, `pericoloso` ed `escludi00`.
   */
  async codiciEer(opzioni?: FiltriCodiciEer, tenantId?: string): Promise<CodificaItem[]> {
    const query = new URLSearchParams()
    if (opzioni?.pericoloso !== undefined) query.set('pericoloso', String(opzioni.pericoloso))
    if (opzioni?.escludi00 !== undefined) query.set('escludi00', String(opzioni.escludi00))
    const qs = query.toString()

    const contesto = '/lookup/codici-eer'
    const response = await this.get(
      `${RentriCodificheClient.CODIFICHE_PATH}${contesto}${qs ? `?${qs}` : ''}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /lookup/comuni`: intero catalogo comuni, inclusi quelli non più
   * attivi (fusioni/soppressioni) — a differenza di `comuni/{provincia_id}`,
   * questo path non dichiara il filtro `attivi`.
   */
  async comuni(tenantId?: string): Promise<CodificaItem[]> {
    const contesto = '/lookup/comuni'
    const response = await this.get(
      `${RentriCodificheClient.CODIFICHE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /lookup/comuni/{provincia_id}`: qui il contratto dichiara `attivi`
   * (default `true`) — un comune soppresso/accorpato non compare a meno che
   * il chiamante chieda esplicitamente `attivi=false`.
   */
  async comuniProvincia(
    provinciaId: string,
    opzioni?: FiltriComuniProvincia,
    tenantId?: string
  ): Promise<CodificaItem[]> {
    const query = new URLSearchParams()
    if (opzioni?.comuneId !== undefined) query.set('comune_id', opzioni.comuneId)
    if (opzioni?.attivi !== undefined) query.set('attivi', String(opzioni.attivi))
    const qs = query.toString()

    const contesto = `/lookup/comuni/${provinciaId}`
    const response = await this.get(
      `${RentriCodificheClient.CODIFICHE_PATH}${contesto}${qs ? `?${qs}` : ''}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /status`: stato del servizio `codifiche` (`Ok`/`Warning`/`Planned`).
   * Il contratto non dichiara sicurezza su questo path (v. anche l'oracolo,
   * `tools/rentri-fake/src/routes/codifiche.ts`): nessuna autenticazione.
   */
  async stato(): Promise<StatoServizioCodifiche> {
    const url = `${this.config.baseUrl}${RentriCodificheClient.CODIFICHE_PATH}/status`
    const response = await firstValueFrom(this.httpService.get(url, { timeout: this.timeout }))
    return response.data
  }

  /**
   * Scarica in sequenza TUTTE le tabelle di codifiche "allinea ora": le 21
   * tabelle semplici + `codici-eer` (con `escludi00=false` esplicito: i
   * codici di capitolo non vanno esclusi silenziosamente, la logica di
   * visualizzazione filtra a valle se serve) + `comuni` (intero catalogo,
   * soppressi inclusi — la logica di validità la applica chi consuma il
   * dato, non questo client). 23 chiamate `GET` in tutto.
   *
   * **Mai in parallelo**: v. il commento di testata della classe per la
   * strategia di rate-limiting (concorrenza 1, pausa minima
   * {@link INTERVALLO_MINIMO_TRA_RICHIESTE_MS} tra una tabella e la
   * successiva). Il chiamante (un futuro `RentriCodificheSyncService`, task
   * successivo) decide cosa farne del risultato; questo metodo si limita a
   * restituire i dati grezzi in una mappa chiave = nome tabella (stesso
   * segmento di path del contratto).
   *
   * Un errore non ritentabile (403) o con tentativi di resilienza esauriti
   * (429/423/5xx) su una qualunque tabella interrompe l'intero ciclo: non ha
   * senso proseguire un allineamento parziale quando l'ente ha appena
   * rifiutato o bandito il chiamante.
   */
  async scaricaTutte(tenantId?: string): Promise<Map<string, CodificaItem[]>> {
    const risultato = new Map<string, CodificaItem[]>()

    for (const nomeTabella of NOME_TABELLE_CODIFICHE_SEMPLICI) {
      risultato.set(nomeTabella, await this.leggiTabella(nomeTabella, tenantId))
      await this.pausaTraRichieste()
    }

    risultato.set('codici-eer', await this.codiciEer({ escludi00: false }, tenantId))
    await this.pausaTraRichieste()

    risultato.set('comuni', await this.comuni(tenantId))

    return risultato
  }

  /** V. commento di testata della classe per la motivazione del valore. */
  private async pausaTraRichieste(): Promise<void> {
    await attendiMs(RentriCodificheClient.INTERVALLO_MINIMO_TRA_RICHIESTE_MS)
  }

  /**
   * GET con Bearer self-issued ({@link RentriAuthService}) e resilienza
   * condivisa (`../rentri-http-resilienza.ts`): 403 mai ritentato,
   * 429/423/5xx con backoff esponenziale o `Retry-After`. Ogni ritentativo
   * costruisce una nuova autenticazione (nuovo JWT self-issued/`jti`) invece
   * di riusare quella del tentativo precedente — stesso comportamento di
   * {@link RENTRIApiClient.eseguiRichiestaConResilienza}.
   */
  private async get(path: string, tenantId: string | undefined, contesto: string) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriCodificheClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = {
        Authorization: await this.auth.creaAuthorizationHeader(tenantId ?? this.tenantIdCorrente()),
      }

      try {
        return await firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') {
          // Nessuna risposta HTTP riconoscibile (es. timeout, errore di rete).
          throw error
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriCodificheClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriCodificheClient.BACKOFF_BASE_MS,
            maxMs: RentriCodificheClient.BACKOFF_MAX_MS,
          }
        )
        // 'ritenta': si riprova il ciclo (l'attesa è già stata eseguita sopra).
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /**
   * Tenant per cui firmare il JWT self-issued: quello del contesto della
   * richiesta corrente, oppure stringa vuota (fa scattare il fallback da env
   * dentro {@link RentriAuthService} per il pilota single-operator) — stesso
   * comportamento di {@link RENTRIApiClient['tenantIdCorrente']}.
   */
  private tenantIdCorrente(): string {
    return TenantContext.getTenantId() ?? ''
  }
}
