import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { TenantContext } from '../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriAuthService } from './rentri-auth.service'
import { RentriApiError, gestisciRispostaErroreRentri, attendiMs } from './rentri-http-resilienza'

/**
 * Client del servizio `anagrafiche` di RENTRI
 * (`docs/contracts/rentri/anagrafiche.yaml`), limitato ai path in sola
 * lettura rilevanti per R4 Task 3 (unità locali dell'operatore): tutto il
 * resto del contratto — `/registri` (apertura/modifica/chiusura registro) —
 * resta fuori dall'ambito, sono registri cronologici esplicitamente esclusi
 * dal design del programma (l'API non è pubblicata).
 *
 * Riusa i meccanismi già maturati in {@link RENTRIApiClient} e
 * {@link RentriCodificheClient} invece di duplicarli:
 * - autenticazione ID_AUTH_REST_02 tramite {@link RentriAuthService} (stesso
 *   JWT self-issued Bearer firmato a ogni richiesta — qui non serve la firma
 *   di integrità `Agid-JWT-Signature`, riservata alle richieste con body:
 *   ogni path di questo client è `GET`);
 * - classificazione/backoff degli errori tramite le funzioni condivise di
 *   `rentri-http-resilienza.ts` (403 mai ritentato, 429/423/5xx con backoff
 *   esponenziale o `Retry-After`).
 *
 * **`num_iscr_sito`, formato non vincolato qui.** `formulari.yaml` impone un
 * pattern (`^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$`) al parametro
 * di path usato per l'acquisizione di visibilità — ma è un vincolo di
 * *quel* contratto, sull'input digitato da un operatore. `anagrafiche.yaml`
 * dichiara sia `num_iscr` (operatore) sia `num_iscr_sito` come `string`
 * semplice, senza alcun pattern: il valore che questo client legge è
 * emesso dall'ente stesso, non digitato da nessuno. Il chiamante
 * (`SincronizzaSitiUseCase`) non applica quindi la regex di `formulari.yaml`
 * ai dati letti da qui — applicarla rischierebbe di scartare unità locali
 * realmente iscritte solo perché il loro formato non coincide con quello
 * atteso da un contratto diverso.
 */
@Injectable()
export class RentriAnagraficheClient {
  private readonly timeout = 30000 // 30s

  /**
   * Path base del servizio `anagrafiche` v1.0, confermato da
   * `docs/contracts/rentri/anagrafiche.yaml` (`servers[0].url`). Va
   * concatenato a `config.baseUrl` (solo host, es.
   * `https://demoapi.rentri.gov.it`).
   */
  private static readonly ANAGRAFICHE_PATH = '/anagrafiche/v1.0'

  /** Numero massimo di tentativi per gli errori transitori (429/423/5xx), stesso valore degli altri client RENTRI. */
  private static readonly MAX_TENTATIVI_RESILIENZA = 5

  /** Base (ms) del backoff esponenziale quando l'ente non indica `Retry-After`. */
  private static readonly BACKOFF_BASE_MS = 1000

  /** Tetto (ms) del backoff esponenziale, per non attendere indefinitamente. */
  private static readonly BACKOFF_MAX_MS = 30000

  /** Valore di default dell'header `Paging-Page` (stesso default degli altri servizi RENTRI). */
  private static readonly PAGING_PAGE_DEFAULT = 1

  /** Valore di default dell'header `Paging-PageSize`. */
  private static readonly PAGING_PAGE_SIZE_DEFAULT = 100

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly auth: RentriAuthService
  ) {
    this.logger.setContext('RentriAnagraficheClient')
  }

  /**
   * `GET /operatore/{num_iscr}/siti` (anagrafiche.yaml righe 219-353):
   * elenco paginato delle unità locali dell'operatore. 404 se l'operatore
   * non esiste (propagato come {@link RentriApiError} con `status: 404`,
   * `retryable: false` — stesso trattamento del 403, non è un errore
   * transitorio).
   */
  async elencaSiti(
    numIscrOperatore: string,
    opzioni?: FiltriElencoSiti,
    tenantId?: string
  ): Promise<RisultatoElencoSiti> {
    const page = opzioni?.paging?.page ?? RentriAnagraficheClient.PAGING_PAGE_DEFAULT
    const pageSize = opzioni?.paging?.pageSize ?? RentriAnagraficheClient.PAGING_PAGE_SIZE_DEFAULT

    const contesto = `/operatore/${numIscrOperatore}/siti`
    const response = await this.get(
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      tenantId,
      contesto,
      { 'Paging-Page': String(page), 'Paging-PageSize': String(pageSize) }
    )

    const headers = response.headers ?? {}
    const leggiHeaderNumerico = (nome: string, fallback: number): number => {
      const valore = headers[nome.toLowerCase()] ?? headers[nome]
      const numero = Number(valore)
      return Number.isFinite(numero) ? numero : fallback
    }

    return {
      risultati: Array.isArray(response.data) ? (response.data as SitoAnagraficoModel[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /**
   * `GET /operatore/{num_iscr}/siti/{num_iscr_sito}` (anagrafiche.yaml righe
   * 354-404): dettaglio di una singola unità locale. 404 se l'operatore o
   * l'unità locale non esistono.
   */
  async dettaglioSito(
    numIscrOperatore: string,
    numIscrSito: string,
    tenantId?: string
  ): Promise<SitoAnagraficoModel> {
    const contesto = `/operatore/${numIscrOperatore}/siti/${numIscrSito}`
    const response = await this.get(
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /operatore/{identificativo}/controllo-iscrizione` (anagrafiche.yaml
   * righe 176-218 circa): booleano, l'operatore identificato dal codice
   * fiscale (o altro identificativo) è iscritto a RENTRI?
   */
  async controlloIscrizione(codiceFiscale: string, tenantId?: string): Promise<boolean> {
    const contesto = `/operatore/${codiceFiscale}/controllo-iscrizione`
    const response = await this.get(
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data === true
  }

  /**
   * GET con Bearer self-issued ({@link RentriAuthService}) e resilienza
   * condivisa (`rentri-http-resilienza.ts`): 403/404 mai ritentati,
   * 429/423/5xx con backoff esponenziale o `Retry-After`. Un 404 (operatore
   * o unità locale non trovata) è un esito definitivo del dominio, non un
   * errore transitorio: viene classificato allo stesso modo del 403 da
   * {@link gestisciRispostaErroreRentri} solo se quest'ultima lo tratta come
   * tale — qui lo intercettiamo esplicitamente prima, per restituire un
   * messaggio di dominio chiaro invece del generico "Risposta inattesa".
   */
  private async get(
    path: string,
    tenantId: string | undefined,
    contesto: string,
    extraHeaders?: Record<string, string>
  ) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriAnagraficheClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = {
        Authorization: await this.auth.creaAuthorizationHeader(tenantId ?? this.tenantIdCorrente()),
        ...extraHeaders,
      }

      try {
        return await firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') {
          // Nessuna risposta HTTP riconoscibile (es. timeout, errore di rete).
          throw error
        }

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(
            404,
            'Non trovato',
            'Operatore o unità locale non trovata',
            false
          )
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriAnagraficheClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriAnagraficheClient.BACKOFF_BASE_MS,
            maxMs: RentriAnagraficheClient.BACKOFF_MAX_MS,
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
   * comportamento degli altri client RENTRI.
   */
  private tenantIdCorrente(): string {
    return TenantContext.getTenantId() ?? ''
  }
}

/**
 * `SitoModel` (anagrafiche.yaml componenti, righe 429+): solo i campi
 * rilevanti per la sincronizzazione delle unità locali (R4 Task 3), non
 * l'intero modello (deleghe/autorizzazioni non servono a questo task).
 */
export interface SitoAnagraficoModel {
  num_iscr_sito?: string | null
  num_iscr_operatore?: string | null
  nome?: string | null
  is_sede_legale?: boolean | null
  comune_id?: string | null
  provincia_id?: string | null
  indirizzo?: string | null
  civico?: string | null
  attivita?: string[] | null
  stato?: 'Attivo' | 'Eliminato' | 'Sospeso' | 'Chiuso' | 'DaConfermare' | null
  [key: string]: unknown
}

/** Filtri di {@link RentriAnagraficheClient.elencaSiti}. */
export interface FiltriElencoSiti {
  paging?: {
    page?: number
    pageSize?: number
  }
}

/** Esito paginato di {@link RentriAnagraficheClient.elencaSiti}. */
export interface RisultatoElencoSiti {
  risultati: SitoAnagraficoModel[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}
