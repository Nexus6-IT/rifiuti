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
 * Client del servizio `vidimazione-formulari`
 * (`docs/contracts/rentri/vidimazione-formulari.yaml`, versione
 * 1.0.20260831-1024) — vedi `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`:
 * il servizio esiste davvero (un audit del 25/07 lo aveva erroneamente
 * dichiarato inesistente e le costanti che vi puntavano furono cancellate)
 * ed e' l'ente, non il nostro backend, a produrre `qr_code_bytes` — il
 * contenuto gia' firmato (CBOR/COSE, RFC 8152) del QR da stampare sul
 * formulario. Questo client si limita a orchestrare le chiamate REST; la
 * decodifica Base64 -> Base45 e il disegno del QR vivono in
 * `../qr/` (fuori da questo file).
 *
 * File separato da {@link RENTRIApiClient}/{@link RentriTrasmissioniClient}
 * (altri task in parallelo, v. `docs/contracts/rentri/vidimazione-formulari.yaml`
 * — servizio distinto da `formulari`, `servers[0].url` diverso): stessa
 * strategia di riuso di autenticazione/resilienza tramite
 * {@link RentriAuthService}/`rentri-http-resilienza.ts`, nessuna duplicazione.
 *
 * Copre tutti e 10 i path del contratto, nell'ordine di priorita' del task:
 * 1. Vidimazione a blocchi — {@link vidimaFir} (ASYNC, 202) +
 *    {@link attendiEsitoVidimazione} (ciclo NONBLOCK_PULL canonico).
 * 2. {@link verificaNumeroFir} (`GET /verifica/{numero_fir}`, pubblico).
 * 3. Il resto: {@link elencaBlocchi}, {@link elencaFirVidimati},
 *    {@link dettaglioFir}, {@link annullaFir}, {@link pdfModello},
 *    {@link statoApi}, {@link certificato}.
 */
@Injectable()
export class RentriVidimazioneClient {
  private readonly timeout = 30000 // 30s

  /** Path base del servizio `vidimazione-formulari` v1.0 (`servers[0].url` del contratto). */
  private static readonly VIDIMAZIONE_PATH = '/vidimazione-formulari/v1.0'

  private static readonly MAX_TENTATIVI_RESILIENZA = 5
  private static readonly BACKOFF_BASE_MS = 1000
  private static readonly BACKOFF_MAX_MS = 30000

  private static readonly PAGING_PAGE_DEFAULT = 1
  private static readonly PAGING_PAGE_SIZE_DEFAULT = 100

  /** Intervallo/tentativi di default del polling NONBLOCK_PULL di {@link attendiEsitoVidimazione}. */
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
    this.logger.setContext('RentriVidimazioneClient')
  }

  /**
   * `GET /` (righe "Elenco blocchi"): elenco paginato dei blocchi virtuali
   * del soggetto. `identificativo` (codice fiscale) e' obbligatorio dal
   * contratto — un client con un `identificativo` vuoto riceverebbe 400.
   */
  async elencaBlocchi(
    identificativo: string,
    filtri?: FiltriElencoBlocchi,
    tenantId?: string
  ): Promise<RisultatoElencoBlocchi> {
    const page = filtri?.paging?.page ?? RentriVidimazioneClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri?.paging?.pageSize ?? RentriVidimazioneClient.PAGING_PAGE_SIZE_DEFAULT

    const query = new URLSearchParams({ identificativo })
    if (filtri?.numIscrSito) query.set('num_iscr_sito', filtri.numIscrSito)
    if (filtri?.codiceBlocco) query.set('codice_blocco', filtri.codiceBlocco)
    if (filtri?.ancheDisattivi !== undefined) {
      query.set('anche_disattivi', String(filtri.ancheDisattivi))
    }

    const contesto = '/'
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}/?${query.toString()}`,
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
      risultati: Array.isArray(response.data) ? (response.data as BloccoModel[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /**
   * `POST /{codice_blocco}` (righe "🔁[ASYNC] Vidimazione nuovo FIR"): avvia
   * la vidimazione di un nuovo FIR sul blocco indicato. **ASYNC** — 202 +
   * `TransazioneModel`, header `Location` verso `/{transazione_id}/status`
   * (assente se si passa `replyTo`, stesso trattamento di
   * {@link RentriTrasmissioniClient.estraiDatiXfir}). Nessun corpo: il
   * contratto non dichiara un `requestBody` per questo path.
   */
  async vidimaFir(
    codiceBlocco: string,
    opzioni?: { replyTo?: string },
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = `/${codiceBlocco}`
    const extraHeaders = opzioni?.replyTo ? { 'X-ReplyTo': opzioni.replyTo } : undefined

    const response = await this.post(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}`,
      contesto,
      tenantId,
      extraHeaders
    )

    const urlStato = (response.headers?.location ?? response.headers?.Location) as
      | string
      | undefined
    return { transazioneId: response.data?.transazione_id, urlStato }
  }

  /**
   * Attende l'esito di {@link vidimaFir}, seguendo il ciclo NONBLOCK_PULL
   * canonico (`GET .../status` — 200 finche' in elaborazione, 303 +
   * `Location` quando pronto — poi `GET .../result`, 400 problem+json =
   * "richiesta anticipata"). Versione slim, stesso principio di
   * {@link RentriTrasmissioniClient.attendiEsitoEstrazione}: nessun rate
   * limiter dedicato.
   */
  async attendiEsitoVidimazione(
    transazioneId: string,
    opzioni?: { intervalloMs?: number; maxTentativi?: number },
    tenantId?: string
  ): Promise<EsitoVidimazioneModel> {
    const intervalloMs =
      opzioni?.intervalloMs ?? RentriVidimazioneClient.INTERVALLO_POLLING_DEFAULT_MS
    const maxTentativi =
      opzioni?.maxTentativi ?? RentriVidimazioneClient.MAX_TENTATIVI_POLLING_DEFAULT

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
      `Superato il numero massimo di tentativi (${maxTentativi}) in attesa dell'esito della vidimazione RENTRI ${transazioneId}.`
    )
  }

  /**
   * `GET /{codice_blocco}` (righe "Elenco FIR vidimati"): elenco paginato dei
   * FIR gia' vidimati sul blocco, ciascuno con il proprio `qr_code_bytes`.
   */
  async elencaFirVidimati(
    codiceBlocco: string,
    filtri?: { progressivoIniziale?: number; progressivoFinale?: number; paging?: Paging },
    tenantId?: string
  ): Promise<RisultatoElencoFir> {
    const page = filtri?.paging?.page ?? RentriVidimazioneClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri?.paging?.pageSize ?? RentriVidimazioneClient.PAGING_PAGE_SIZE_DEFAULT

    const query = new URLSearchParams()
    if (filtri?.progressivoIniziale !== undefined) {
      query.set('progressivo_iniziale', String(filtri.progressivoIniziale))
    }
    if (filtri?.progressivoFinale !== undefined) {
      query.set('progressivo_finale', String(filtri.progressivoFinale))
    }
    const qs = query.toString()

    const contesto = `/${codiceBlocco}`
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}${qs ? `?${qs}` : ''}`,
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
      risultati: Array.isArray(response.data) ? (response.data as EfirPublicModel[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /**
   * `GET /{codice_blocco}/{progressivo}` (righe "Dati di vidimazione FIR"):
   * dettaglio completo (`EfirModel`, include i campi privati assenti da
   * `EfirPublicModel`). `conXml` chiede anche l'xml firmato (`?xml=true`) —
   * la fake non lo modella (fuori scope dichiarato, v. `routes/vidimazione.ts`),
   * ma il parametro resta passato fedelmente al contratto.
   */
  async dettaglioFir(
    codiceBlocco: string,
    progressivo: number,
    opzioni?: { conXml?: boolean },
    tenantId?: string
  ): Promise<EfirModel> {
    const qs = opzioni?.conXml ? '?xml=true' : ''
    const contesto = `/${codiceBlocco}/${progressivo}`
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}${qs}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `PUT /{codice_blocco}/{progressivo}/annulla` (righe "Annulla vidimazione
   * FIR"): 200 senza corpo, **non reversibile** (stesso principio di
   * {@link RentriTrasmissioniClient.annullaTrasmissione}).
   */
  async annullaFir(codiceBlocco: string, progressivo: number, tenantId?: string): Promise<void> {
    const contesto = `/${codiceBlocco}/${progressivo}/annulla`
    await this.put(`${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}`, contesto, tenantId)
  }

  /**
   * `GET /{codice_blocco}/{progressivo}/pdf` (righe "Modello FIR PDF"): il
   * modello PDF ufficiale dell'ente per il FIR vidimato (`DownloadableBaseResponse`,
   * `content` Base64). Alternativa a impaginare noi stessi il documento —
   * fuori dall'ambito di questo client, che si limita a scaricarlo.
   */
  async pdfModello(
    codiceBlocco: string,
    progressivo: number,
    opzioni?: { senzaNumeroPagina?: boolean },
    tenantId?: string
  ): Promise<DownloadableBaseResponse> {
    const qs = opzioni?.senzaNumeroPagina ? '?senza_numero_pagina=true' : ''
    const contesto = `/${codiceBlocco}/${progressivo}/pdf`
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}${qs}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /verifica/{numero_fir}` (righe "Verifica numero FIR"): verifica
   * pubblica di un numero FIR gia' vidimato (`EfirPublicModel`) — priorita' 2
   * del task, insieme alla vidimazione a blocchi.
   */
  async verificaNumeroFir(numeroFir: string, tenantId?: string): Promise<EfirPublicModel> {
    const contesto = `/verifica/${numeroFir}`
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /** `GET /status` (righe "Stato API"): stato operativo del servizio. */
  async statoApi(tenantId?: string): Promise<StatusResponse> {
    const contesto = '/status'
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /certificati/{certificato_id}` (righe "Certificato di firma"): i
   * certificati con cui l'ente firma il `qr_code_bytes`/l'xml — utile solo
   * per una verifica crittografica del COSE, fuori dall'ambito di questo
   * client (v. `routes/vidimazione.ts`, la fake risponde sempre elenco vuoto).
   */
  async certificato(certificatoId: string, tenantId?: string): Promise<CertificateModel[]> {
    const contesto = `/certificati/${certificatoId}`
    const response = await this.get(
      `${RentriVidimazioneClient.VIDIMAZIONE_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return Array.isArray(response.data) ? response.data : []
  }

  private async interrogaStatoTransazione(
    transazioneId: string,
    tenantId?: string
  ): Promise<{ pronto: boolean; urlEsito?: string }> {
    const url = `${this.config.baseUrl}${RentriVidimazioneClient.VIDIMAZIONE_PATH}/${transazioneId}/status`
    const contesto = `/${transazioneId}/status`

    for (
      let tentativo = 1;
      tentativo <= RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA;
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
        RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        {
          baseMs: RentriVidimazioneClient.BACKOFF_BASE_MS,
          maxMs: RentriVidimazioneClient.BACKOFF_MAX_MS,
        },
        tenantId ?? this.tenantIdCorrente()
      )
    }

    throw new Error(
      `Superato il numero massimo di tentativi interrogando ${contesto} per la transazione ${transazioneId}.`
    )
  }

  private async leggiEsitoTransazione(
    urlEsito: string | undefined,
    tenantId?: string
  ): Promise<EsitoVidimazioneModel | null> {
    if (!urlEsito) {
      throw new Error('Risposta 303 da /status priva di header Location')
    }
    const url = urlEsito.startsWith('http') ? urlEsito : `${this.config.baseUrl}${urlEsito}`

    for (
      let tentativo = 1;
      tentativo <= RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA;
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
        RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        {
          baseMs: RentriVidimazioneClient.BACKOFF_BASE_MS,
          maxMs: RentriVidimazioneClient.BACKOFF_MAX_MS,
        },
        tenantId ?? this.tenantIdCorrente()
      )
    }

    throw new Error(`Superato il numero massimo di tentativi leggendo /result (${url}).`)
  }

  /** GET con Bearer self-issued. 404 intercettato esplicitamente, stesso trattamento di {@link RentriTrasmissioniClient}. */
  private async get(
    path: string,
    tenantId: string | undefined,
    contesto: string,
    extraHeaders?: Record<string, string>
  ) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA;
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
          throw new RentriApiError(404, 'Non trovato', 'Risorsa non trovata', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriVidimazioneClient.BACKOFF_BASE_MS,
            maxMs: RentriVidimazioneClient.BACKOFF_MAX_MS,
          },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /**
   * POST con Bearer self-issued. Nessun corpo (nessun path di questo gruppo
   * dichiara un `requestBody`, v. commento di testata) e nessuna firma di
   * integrita' (quest'ultima e' richiesta solo quando esiste un corpo da
   * firmare, come in `RentriTrasmissioniClient.post`). 404 intercettato
   * esplicitamente, stesso trattamento di {@link get}.
   */
  private async post(
    path: string,
    contesto: string,
    tenantId?: string,
    extraHeaders?: Record<string, string>
  ) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = { ...(await this.buildAuthHeaders(tenantId)), ...extraHeaders }

      try {
        return await firstValueFrom(
          this.httpService.post(url, undefined, { headers, timeout: this.timeout })
        )
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Blocco non trovato', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriVidimazioneClient.BACKOFF_BASE_MS,
            maxMs: RentriVidimazioneClient.BACKOFF_MAX_MS,
          },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /**
   * PUT con Bearer self-issued. Nessuna firma di integrita': il contratto non
   * documenta un corpo per `.../annulla` (solo path), stesso principio di
   * {@link RentriTrasmissioniClient['delete_']}.
   */
  private async put(path: string, contesto: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`

    for (
      let tentativo = 1;
      tentativo <= RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const headers = await this.buildAuthHeaders(tenantId)

      try {
        return await firstValueFrom(
          this.httpService.put(url, undefined, { headers, timeout: this.timeout })
        )
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'FIR vidimato non trovato', false)
        }
        // 400 (es. FIR gia' annullato) NON rimappato su un errore tipizzato:
        // stessa scelta di `RentriTrasmissioniClient.annullaTrasmissione`.

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriVidimazioneClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriVidimazioneClient.BACKOFF_BASE_MS,
            maxMs: RentriVidimazioneClient.BACKOFF_MAX_MS,
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

/** `BloccoModel` (vidimazione-formulari.yaml). */
export interface BloccoModel {
  disattivo: boolean
  identificativo_soggetto?: string | null
  denominazione_soggetto?: string | null
  codice_blocco?: string | null
  descrizione?: string | null
  codice_fiscale_utente?: string | null
  data_creazione?: string | null
  numero_fir_vidimati: number
  data_ultimo_utilizzo?: string | null
  num_iscr_sito?: string | null
  indirizzo?: string | null
  civico?: string | null
  comune_id?: string | null
}

/** `EfirPublicModel` (vidimazione-formulari.yaml). */
export interface EfirPublicModel {
  progressivo: number
  numero_fir?: string | null
  /** Base64 dei byte firmati dall'ente (CBOR/COSE, RFC 8152) — v. commento di testata. */
  qr_code_bytes?: string | null
  check_sum?: string | null
  data_richiesta: string
  denominazione_soggetto?: string | null
  codice_fiscale_soggetto?: string | null
  num_iscr_sito?: string | null
  codice_blocco?: string | null
  cciaa_nome?: string | null
  is_annullato?: boolean | null
  data_annullamento?: string | null
}

/** `EfirModel` (vidimazione-formulari.yaml): come `EfirPublicModel`, piu' i campi privati. */
export interface EfirModel extends EfirPublicModel {
  utente_richiesta?: string | null
  denominazione_utente_richiesta?: string | null
  utente_annullamento?: string | null
  origine?: 'Portale' | 'Api' | null
  xml?: string | null
}

/** `EsitoVidimazioneModel` (vidimazione-formulari.yaml). */
export interface EsitoVidimazioneModel {
  esito?: EfirPublicModel | null
  tipo?: string | null
  transazione_id: string
  validazione?: unknown[] | null
  errore: boolean
  tempo_elaborazione?: string | null
}

/** `DownloadableBaseResponse` (vidimazione-formulari.yaml). */
export interface DownloadableBaseResponse {
  nome_file?: string | null
  mime?: string | null
  content?: string | null
}

/** `StatusResponse` (vidimazione-formulari.yaml). */
export interface StatusResponse {
  status: 'Ok' | 'Warning' | 'Planned'
  warnings?: string[] | null
  planned_notices?: string[] | null
}

/** `CertificateModel` (vidimazione-formulari.yaml). */
export interface CertificateModel {
  certificato?: string | null
  subject?: string | null
}

/** Filtri di {@link RentriVidimazioneClient.elencaBlocchi}. */
export interface FiltriElencoBlocchi {
  numIscrSito?: string
  codiceBlocco?: string
  ancheDisattivi?: boolean
  paging?: Paging
}

export interface Paging {
  page?: number
  pageSize?: number
}

interface RisultatoPaginato<T> {
  risultati: T[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}

export type RisultatoElencoBlocchi = RisultatoPaginato<BloccoModel>
export type RisultatoElencoFir = RisultatoPaginato<EfirPublicModel>
