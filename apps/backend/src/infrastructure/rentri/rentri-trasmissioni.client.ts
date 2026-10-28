import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { TenantContext } from '../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriAuthService } from './rentri-auth.service'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriApiError, gestisciRispostaErroreRentri, attendiMs } from './rentri-http-resilienza'

/**
 * Client del gruppo `Trasmissione dati operatore` del servizio `formulari`
 * di RENTRI (`docs/contracts/rentri/formulari.yaml`, righe 5149-5577):
 * l'adempimento di TRASMISSIONE DEI DATI dei formulari relativi a rifiuti
 * pericolosi, con decorrenza delle sanzioni dal 15/09/2026 — prima di questo
 * client, cercare «trasmissioni» nel codice trovava solo nomi di diagnostica
 * interna, mai una chiamata alla rotta dell'ente.
 *
 * Limitato alla variante **operatore** (`/trasmissioni/operatore/...`), l'unica
 * rilevante per il nostro backend (che agisce sempre per conto della propria
 * unità locale, eventualmente per il produttore che rappresenta): la variante
 * `soggetto-delegato` e i path deprecati (`/trasmissioni/{num_iscr_sito}/...`,
 * senza `/operatore/`, in favore dei quali quelli qui usati sono i canonici)
 * restano fuori dall'ambito di questo client.
 *
 * File separato da {@link RENTRIApiClient} (`rentri-api.client.ts`, ~1700
 * righe, su cui lavora in parallelo un altro task) — stessa strategia già
 * adottata da {@link RentriCodificheClient}/{@link RentriAnagraficheClient}:
 * niente duplicazione dei meccanismi di autenticazione/resilienza, che
 * restano condivisi tramite {@link RentriAuthService} e
 * `rentri-http-resilienza.ts`.
 *
 * - `POST`/`GET`/`DELETE` di questo gruppo (invio, elenco, dettaglio,
 *   annullamento) sono **sincroni**: il contratto non dichiara alcun
 *   `TransazioneModel` per questi path (a differenza di "Crea FIR").
 * - Solo `POST .../{numero_fir}/estrai` è **ASYNC** (202 + `TransazioneModel`
 *   + header `Location`) e riusa il ciclo NONBLOCK_PULL generico già
 *   canonizzato dal contratto su `/{transazione_id}/status` e `/result`
 *   (formulari.yaml righe 2801-2897) — stesso path base di
 *   {@link RENTRIApiClient.attendiEsito}, qui reimplementato in forma slim
 *   (senza rate limiter/metriche di polling dedicate: questo client non ha
 *   ancora un caso d'uso che scarichi centinaia di estrazioni in sequenza,
 *   a differenza del ciclo di creazione FIR).
 */
@Injectable()
export class RentriTrasmissioniClient {
  private readonly timeout = 30000 // 30s

  /**
   * Path base del servizio `formulari` v1.0 (stesso di `RENTRIApiClient` e
   * `docs/contracts/rentri/formulari.yaml`, `servers[0].url`): i path di
   * questo gruppo (`/trasmissioni/operatore/...`) sono relativi a questo
   * prefisso, non un servizio a parte.
   */
  private static readonly FORMULARI_PATH = '/formulari/v1.0'

  private static readonly MAX_TENTATIVI_RESILIENZA = 5
  private static readonly BACKOFF_BASE_MS = 1000
  private static readonly BACKOFF_MAX_MS = 30000

  private static readonly PAGING_PAGE_DEFAULT = 1
  private static readonly PAGING_PAGE_SIZE_DEFAULT = 100

  /** Intervallo/tentativi di default del polling NONBLOCK_PULL di {@link attendiEsitoEstrazione}. */
  private static readonly INTERVALLO_POLLING_DEFAULT_MS = 2000
  private static readonly MAX_TENTATIVI_POLLING_DEFAULT = 30

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly auth: RentriAuthService,
    private readonly signature: RentriSignatureService
  ) {
    this.logger.setContext('RentriTrasmissioniClient')
  }

  /**
   * `POST /trasmissioni/operatore/{num_iscr_sito}` (formulari.yaml righe
   * 5278-5365): trasmette i dati estratti da un FIR digitale. SINCRONA — 201
   * Created, corpo `TrasmissioneFormularioResponse` (`{ identificativo }`).
   *
   * `numIscrSitoProduttore`, se indicato, dichiara che la trasmissione è
   * effettuata dal trasportatore per conto del produttore (query
   * `num_iscr_sito_produttore`, righe 5311-5316) — il chiamante è
   * responsabile di verificare a monte le precondizioni di dominio (FIR
   * vidimato al trasportatore): questo client si limita a comporre e
   * inviare la richiesta.
   */
  async inviaTrasmissione(
    numIscrSito: string,
    corpo: Record<string, unknown>,
    opzioni?: { numIscrSitoProduttore?: string },
    tenantId?: string
  ): Promise<{ identificativo: string | null }> {
    const query = opzioni?.numIscrSitoProduttore
      ? `?num_iscr_sito_produttore=${encodeURIComponent(opzioni.numIscrSitoProduttore)}`
      : ''
    const contesto = `/trasmissioni/operatore/${numIscrSito}`
    const response = await this.post(
      `${RentriTrasmissioniClient.FORMULARI_PATH}${contesto}${query}`,
      corpo,
      contesto,
      tenantId
    )
    return response.data
  }

  /**
   * `GET /trasmissioni/operatore/{num_iscr_sito}` (formulari.yaml righe
   * 5149-5277): elenco paginato delle trasmissioni effettuate per l'unità
   * locale, con i filtri dichiarati dal contratto.
   */
  async elencaTrasmissioni(
    numIscrSito: string,
    filtri?: FiltriElencoTrasmissioni,
    tenantId?: string
  ): Promise<RisultatoElencoTrasmissioni> {
    const page = filtri?.paging?.page ?? RentriTrasmissioniClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri?.paging?.pageSize ?? RentriTrasmissioniClient.PAGING_PAGE_SIZE_DEFAULT

    const query = new URLSearchParams()
    if (filtri?.numeroFir) query.set('numero_fir', filtri.numeroFir)
    if (filtri?.dataTrasmissioneDa) query.set('data_trasmissione_da', filtri.dataTrasmissioneDa)
    if (filtri?.dataTrasmissioneA) query.set('data_trasmissione_a', filtri.dataTrasmissioneA)
    if (filtri?.codiceEer) query.set('codice_eer', filtri.codiceEer)
    if (filtri?.tipo) query.set('tipo', filtri.tipo)
    if (filtri?.stato) query.set('stato', filtri.stato)
    if (filtri?.includiTrasportatorePerContoProduttore !== undefined) {
      query.set(
        'includi_trasportatore_per_conto_produttore',
        String(filtri.includiTrasportatorePerContoProduttore)
      )
    }
    const qs = query.toString()

    const contesto = `/trasmissioni/operatore/${numIscrSito}`
    const response = await this.get(
      `${RentriTrasmissioniClient.FORMULARI_PATH}${contesto}${qs ? `?${qs}` : ''}`,
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
      risultati: Array.isArray(response.data) ? (response.data as TrasmissioneDatiItemModel[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /**
   * `GET /trasmissioni/operatore/{num_iscr_sito}/{identificativo}`
   * (formulari.yaml righe 5366-5413): dettaglio di una trasmissione, incluso
   * il formulario trasmesso (`TrasmissioneDatiResult.formulario`). 404 se
   * l'identificativo non esiste per quell'unità locale.
   */
  async dettaglioTrasmissione(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<TrasmissioneDatiResultModel> {
    const contesto = `/trasmissioni/operatore/${numIscrSito}/${identificativo}`
    const response = await this.get(
      `${RentriTrasmissioniClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `DELETE /trasmissioni/operatore/{num_iscr_sito}/{identificativo}/annulla`
   * (formulari.yaml righe 5414-5467): pone la trasmissione in stato
   * "annullata". **Non reversibile** (v. descrizione del contratto) — un 400
   * indica tipicamente un tentativo di annullare una trasmissione già
   * annullata.
   */
  async annullaTrasmissione(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<void> {
    const contesto = `/trasmissioni/operatore/${numIscrSito}/${identificativo}/annulla`
    await this.delete_(`${RentriTrasmissioniClient.FORMULARI_PATH}${contesto}`, contesto, tenantId)
  }

  /**
   * `POST /trasmissioni/operatore/{num_iscr_sito}/{numero_fir}/estrai`
   * (formulari.yaml righe 5468-5577): estrae dal file xFIR i dati da
   * trasmettere. **ASYNC** — 202 Accepted, corpo `TransazioneModel`
   * (`transazione_id`), header `Location` verso `/{transazione_id}/status`
   * (assente se si specifica `replyTo`, nel qual caso l'esito arriva via
   * callback — questo client non implementa un endpoint di callback: chi
   * passa `replyTo` è responsabile di esporlo e di correlare la notifica).
   *
   * `xfirBase64` è il contenuto del file xFIR (`EstraiDatiXfirModel.xfir`,
   * `format: byte`) già codificato base64 — nessuna validazione di
   * dimensione (limite 3 MB dichiarato dal contratto) è applicata qui: è
   * responsabilità del chiamante.
   */
  async estraiDatiXfir(
    numIscrSito: string,
    numeroFir: string,
    xfirBase64: string,
    opzioni?: { replyTo?: string },
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = `/trasmissioni/operatore/${numIscrSito}/${numeroFir}/estrai`
    const rawBody = JSON.stringify({ xfir: xfirBase64 })

    // Stesso tenant effettivo per Bearer e firma di integrità.
    const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
    const authorization = await this.auth.creaAuthorizationHeader(tenantEffettivo)
    const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody, tenantEffettivo)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: authorization,
      ...integrityHeaders,
      ...(opzioni?.replyTo ? { 'X-ReplyTo': opzioni.replyTo } : {}),
    }

    const url = `${this.config.baseUrl}${RentriTrasmissioniClient.FORMULARI_PATH}${contesto}`
    const response = await firstValueFrom(
      this.httpService.post(url, { xfir: xfirBase64 }, { headers, timeout: this.timeout })
    )

    const urlStato = (response.headers?.location ?? response.headers?.Location) as
      | string
      | undefined
    return { transazioneId: response.data?.transazione_id, urlStato }
  }

  /**
   * Attende l'esito di una transazione creata da {@link estraiDatiXfir},
   * seguendo il ciclo NONBLOCK_PULL canonico (formulari.yaml righe
   * 2801-2897 — GLI STESSI path usati per "Crea FIR", non quelli deprecati
   * sotto `/trasmissioni/{transazione_id}/...`): `GET .../status` (200 senza
   * corpo finché in elaborazione, 303 + `Location` quando pronto), poi
   * `GET .../result` (400 problem+json = "richiesta anticipata", non un
   * errore definitivo).
   *
   * Versione slim di {@link RENTRIApiClient.attendiEsito}: nessun
   * `conRateLimiter` (questo client non ha ancora un caso d'uso a volume che
   * lo giustifichi) — stesso principio di `RentriCodificheClient`/
   * `RentriAnagraficheClient`, che condividono solo la resilienza di base.
   */
  async attendiEsitoEstrazione(
    transazioneId: string,
    opzioni?: { intervalloMs?: number; maxTentativi?: number },
    tenantId?: string
  ): Promise<unknown> {
    const intervalloMs =
      opzioni?.intervalloMs ?? RentriTrasmissioniClient.INTERVALLO_POLLING_DEFAULT_MS
    const maxTentativi =
      opzioni?.maxTentativi ?? RentriTrasmissioniClient.MAX_TENTATIVI_POLLING_DEFAULT

    if (maxTentativi < 1) {
      throw new Error('maxTentativi deve essere almeno 1')
    }

    for (let tentativo = 1; tentativo <= maxTentativi; tentativo++) {
      const stato = await this.interrogaStatoTransazione(transazioneId, tenantId)

      if (stato.pronto) {
        const esito = await this.leggiEsitoTransazione(stato.urlEsito, tenantId)
        if (esito !== null) {
          return esito
        }
      }

      if (tentativo < maxTentativi) {
        await attendiMs(intervalloMs)
      }
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${maxTentativi}) in attesa dell'esito della transazione RENTRI ${transazioneId}.`
    )
  }

  private async interrogaStatoTransazione(
    transazioneId: string,
    tenantId?: string
  ): Promise<{ pronto: boolean; urlEsito?: string }> {
    const url = `${this.config.baseUrl}${RentriTrasmissioniClient.FORMULARI_PATH}/${transazioneId}/status`
    const contesto = `/${transazioneId}/status`

    for (
      let tentativo = 1;
      tentativo <= RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = await this.buildAuthHeaders(tenantId)
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers,
          timeout: this.timeout,
          maxRedirects: 0,
          validateStatus: () => true,
        })
      )

      if (response.status === 200) return { pronto: false }
      if (response.status === 303) {
        const urlEsito = (response.headers?.location ?? response.headers?.Location) as string
        return { pronto: true, urlEsito }
      }

      await gestisciRispostaErroreRentri(
        response,
        contesto,
        tentativo,
        RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        {
          baseMs: RentriTrasmissioniClient.BACKOFF_BASE_MS,
          maxMs: RentriTrasmissioniClient.BACKOFF_MAX_MS,
        },
        tenantId ?? this.tenantIdCorrente()
      )
      // 'ritenta': si riprova il ciclo (l'attesa e' gia' stata eseguita sopra).
    }

    throw new Error(
      `Superato il numero massimo di tentativi interrogando ${contesto} per la transazione ${transazioneId}.`
    )
  }

  private async leggiEsitoTransazione(
    urlEsito: string | undefined,
    tenantId?: string
  ): Promise<unknown | null> {
    if (!urlEsito) {
      throw new Error('Risposta 303 da /status priva di header Location')
    }
    const url = urlEsito.startsWith('http') ? urlEsito : `${this.config.baseUrl}${urlEsito}`

    for (
      let tentativo = 1;
      tentativo <= RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = await this.buildAuthHeaders(tenantId)
      const response = await firstValueFrom(
        this.httpService.get(url, { headers, timeout: this.timeout, validateStatus: () => true })
      )

      if (response.status === 400) return null
      if (response.status === 200) return response.data

      await gestisciRispostaErroreRentri(
        response,
        '/result',
        tentativo,
        RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        {
          baseMs: RentriTrasmissioniClient.BACKOFF_BASE_MS,
          maxMs: RentriTrasmissioniClient.BACKOFF_MAX_MS,
        },
        tenantId ?? this.tenantIdCorrente()
      )
    }

    throw new Error(`Superato il numero massimo di tentativi leggendo /result (${url}).`)
  }

  /**
   * POST con Bearer self-issued + firma di integrità Agid-JWT-Signature (il
   * body esiste sempre per questo verbo in questo gruppo di rotte). 404
   * intercettato esplicitamente per un messaggio di dominio chiaro, stesso
   * trattamento di {@link RentriAnagraficheClient}.
   */
  private async post(path: string, body: unknown, contesto: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`
    const rawBody = JSON.stringify(body)

    for (
      let tentativo = 1;
      tentativo <= RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      // Stesso tenant effettivo per Bearer e firma di integrità.
      const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
      const authorization = await this.auth.creaAuthorizationHeader(tenantEffettivo)
      const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody, tenantEffettivo)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authorization,
        ...integrityHeaders,
      }

      try {
        return await firstValueFrom(
          this.httpService.post(url, body, { headers, timeout: this.timeout })
        )
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Unita locale non trovata', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriTrasmissioniClient.BACKOFF_BASE_MS,
            maxMs: RentriTrasmissioniClient.BACKOFF_MAX_MS,
          },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /** GET con Bearer self-issued. V. {@link post} per il trattamento del 404. */
  private async get(
    path: string,
    tenantId: string | undefined,
    contesto: string,
    extraHeaders?: Record<string, string>
  ) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = { ...(await this.buildAuthHeaders(tenantId)), ...extraHeaders }

      try {
        return await firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Trasmissione non trovata', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriTrasmissioniClient.BACKOFF_BASE_MS,
            maxMs: RentriTrasmissioniClient.BACKOFF_MAX_MS,
          },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /**
   * DELETE con Bearer self-issued. Nessuna firma di integrità: il contratto
   * non documenta un corpo per `.../annulla` (solo path/header) — stesso
   * principio di `RENTRIApiClient['delete_']`.
   */
  private async delete_(path: string, contesto: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = await this.buildAuthHeaders(tenantId)

      try {
        return await firstValueFrom(
          this.httpService.delete(url, { headers, timeout: this.timeout })
        )
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Trasmissione non trovata', false)
        }
        // 400 (es. trasmissione gia' annullata) NON viene rimappato su un
        // `RentriApiError` dedicato: come altrove in questo programma (v. il
        // commento di `RENTRIApiClient` sul 400 di `/acquisizione-firma`),
        // non esiste una fonte ufficiale che ne confermi la semantica oltre
        // "Bad Request" — propaga quindi come eccezione generica tramite
        // `gestisciRispostaErroreRentri` (400 non e' ne' 403 ne' ritentabile,
        // quindi finisce nel ramo "Risposta inattesa").

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriTrasmissioniClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriTrasmissioniClient.BACKOFF_BASE_MS,
            maxMs: RentriTrasmissioniClient.BACKOFF_MAX_MS,
          },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  private async buildAuthHeaders(tenantId?: string): Promise<Record<string, string>> {
    return {
      Authorization: await this.auth.creaAuthorizationHeader(tenantId ?? this.tenantIdCorrente()),
    }
  }

  private tenantIdCorrente(): string {
    return TenantContext.getTenantId() ?? ''
  }
}

/** `TrasmissioneDatiSitoResult` (formulari.yaml righe 10405-10432). */
export interface TrasmissioneDatiSitoModel {
  num_iscr_sito?: string | null
  codice_fiscale?: string | null
  denominazione?: string | null
  comune_id?: string | null
  indirizzo?: string | null
  civico?: string | null
}

/** `TrasmissioneDatiItemResult` (elenco, formulari.yaml righe 10294-10353). */
export interface TrasmissioneDatiItemModel {
  identificativo?: string | null
  sito_oggetto_trasmissione?: TrasmissioneDatiSitoModel | null
  sito_trasportatore_per_conto_produttore?: TrasmissioneDatiSitoModel | null
  numero_fir?: string | null
  user_name?: string | null
  data_trasmissione?: string | null
  data_emissione?: string | null
  codice_eer?: string | null
  rifiuto_quantita?: number | null
  rifiuto_unita_misura?: 'kg' | 'l' | null
  tipo?: 'Supporto' | 'Api' | 'AppMobileRentri' | null
  stato?: 'Attivo' | 'Annullato' | null
}

/** `TrasmissioneDatiResult` (dettaglio, formulari.yaml righe 10354-10404): come l'item, più `formulario`. */
export interface TrasmissioneDatiResultModel extends TrasmissioneDatiItemModel {
  formulario?: Record<string, unknown> | null
}

/** Filtri di {@link RentriTrasmissioniClient.elencaTrasmissioni}. */
export interface FiltriElencoTrasmissioni {
  numeroFir?: string
  dataTrasmissioneDa?: string
  dataTrasmissioneA?: string
  codiceEer?: string
  tipo?: 'Supporto' | 'Api' | 'AppMobileRentri'
  stato?: 'Attivo' | 'Annullato'
  includiTrasportatorePerContoProduttore?: boolean
  paging?: {
    page?: number
    pageSize?: number
  }
}

/** Esito paginato di {@link RentriTrasmissioniClient.elencaTrasmissioni}. */
export interface RisultatoElencoTrasmissioni {
  risultati: TrasmissioneDatiItemModel[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}
