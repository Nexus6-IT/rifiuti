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
 * Client del servizio `dati-registri` di RENTRI
 * (`docs/contracts/rentri/dati-registri.yaml`, versione 1.0.20260909-1089):
 * il registro cronologico digitale di carico e scarico (R6) — l'adempimento
 * di TRASMISSIONE DEI MOVIMENTI, distinto sia da `formulari` (i FIR) sia da
 * `anagrafiche`/`codifiche`.
 *
 * **`dati-registri` e' un SERVIZIO A SE'**, non un gruppo di path dentro
 * `formulari.yaml`: `servers[0].url` del contratto e'
 * `https://demoapi.rentri.gov.it/dati-registri/v1.0`, un prefisso diverso da
 * `/formulari/v1.0` — da cui {@link DATI_REGISTRI_PATH} qui sotto, non
 * riusato da nessun altro client.
 *
 * Limitato alla variante **operatore** (`/operatore/...`), come da decisione
 * di ambito del task: `/soggetto-delegato/...` resta fuori. Il registro NON
 * si apre tramite alcuna API di questo contratto (nessun path lo crea: tutti
 * presuppongono un `identificativo_registro` gia' esistente, ottenuto sul
 * portale) — questo client non tenta quindi mai di "creare" un registro.
 *
 * - `POST .../movimenti` (trasmissione) e `POST .../valida` (verifica XML)
 *   sono **ASYNC**: 202 + `TransazioneModel`, stesso ciclo NONBLOCK_PULL
 *   canonico di `formulari`/`RentriTrasmissioniClient`, ma sui path di
 *   QUESTO servizio (`/dati-registri/v1.0/{transazione_id}/status|result`,
 *   non quelli di `/formulari/v1.0`).
 * - `GET .../movimenti`, `.../movimenti/count`, `.../movimento/...` sono
 *   **sincroni**.
 *
 * File separato da {@link RENTRIApiClient}/{@link RentriTrasmissioniClient}
 * (dominio diverso, nessuna sovrapposizione di path) — stessa strategia di
 * `RentriAnagraficheClient`: niente duplicazione dei meccanismi di
 * autenticazione/resilienza, condivisi tramite {@link RentriAuthService},
 * {@link RentriSignatureService} e `rentri-http-resilienza.ts`.
 *
 * **Fuori dall'ambito di questo client** (dichiarato, v. anche il commento di
 * `tools/rentri-fake/src/routes/dati-registri.ts`):
 * - `/operatore/transazioni/movimenti/{num_iscr_sito}[...]`: tracciamento
 *   delle transazioni per unita' locale, funzionalita' accessoria mai
 *   richiesta da alcun caso d'uso del backend.
 * - `/status` (bare): stato operativo generale del servizio, non specifico
 *   ai registri.
 * - Le rettifiche/annullamenti non hanno un metodo proprio: si effettuano
 *   componendo un `MovimentoModel` con `riferimenti.numero_registrazione_rettifica`
 *   valorizzato, oppure un `AnnullamentoMovimentoModel`, e passandoli a
 *   {@link inviaMovimenti} come un elemento qualunque dell'array (lo stesso
 *   endpoint accetta entrambi i tipi, `oneOf` — v. contratto righe 510-514).
 */
@Injectable()
export class RentriRegistriClient {
  private readonly timeout = 30000 // 30s

  /** Path base del servizio `dati-registri` v1.0 (v. commento di testata). */
  private static readonly DATI_REGISTRI_PATH = '/dati-registri/v1.0'

  private static readonly MAX_TENTATIVI_RESILIENZA = 5
  private static readonly BACKOFF_BASE_MS = 1000
  private static readonly BACKOFF_MAX_MS = 30000

  private static readonly PAGING_PAGE_DEFAULT = 1
  private static readonly PAGING_PAGE_SIZE_DEFAULT = 100

  /** Intervallo/tentativi di default del polling NONBLOCK_PULL di {@link attendiEsito}. */
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
    this.logger.setContext('RentriRegistriClient')
  }

  /**
   * `POST /operatore/{identificativo_registro}/movimenti` (righe 227-597):
   * trasmette un elenco (1-1000) di registrazioni, nuove/rettifiche
   * (`MovimentoModel`) o annullamenti (`AnnullamentoMovimentoModel`).
   * **ASYNC** — 202 Accepted, corpo `TransazioneModel`. L'esito si legge con
   * {@link attendiEsito} (o manualmente via `/status`+`/result`).
   */
  async inviaMovimenti(
    identificativoRegistro: string,
    movimenti: Array<Record<string, unknown>>,
    opzioni?: { replyTo?: string },
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = `/operatore/${identificativoRegistro}/movimenti`
    const response = await this.post(
      `${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}`,
      movimenti,
      contesto,
      opzioni,
      tenantId
    )
    const urlStato = (response.headers?.location ?? response.headers?.Location) as
      | string
      | undefined
    return { transazioneId: response.data?.transazione_id, urlStato }
  }

  /**
   * `GET /operatore/{identificativo_registro}/movimenti` (righe 227-473):
   * elenco paginato delle registrazioni.
   *
   * **Divergenza dichiarata**: solo i filtri `identificativiMovimento`,
   * `anno`, `progressivo`, `annullato`, `rettificato` sono trasmessi — gli
   * altri dichiarati dal contratto (`causali_operazione`, `codice_eer`,
   * intervalli di data, ...) non hanno ancora un caso d'uso del backend che
   * li richieda (stesso principio di `RentriTrasmissioniClient.elencaTrasmissioni`
   * sui filtri per data).
   */
  async elencaMovimenti(
    identificativoRegistro: string,
    filtri?: FiltriMovimenti,
    tenantId?: string
  ): Promise<RisultatoElencoMovimenti> {
    const page = filtri?.paging?.page ?? RentriRegistriClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri?.paging?.pageSize ?? RentriRegistriClient.PAGING_PAGE_SIZE_DEFAULT

    const query = this.queryFiltri(filtri)
    const contesto = `/operatore/${identificativoRegistro}/movimenti`
    const response = await this.get(
      `${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}${query ? `?${query}` : ''}`,
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
      risultati: Array.isArray(response.data) ? (response.data as DatiMovimentoModel[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /** `GET /operatore/{identificativo_registro}/movimenti/count` (righe 598-792): conteggio, stessi filtri di {@link elencaMovimenti}. */
  async contaMovimenti(
    identificativoRegistro: string,
    filtri?: FiltriMovimenti,
    tenantId?: string
  ): Promise<number> {
    const query = this.queryFiltri(filtri)
    const contesto = `/operatore/${identificativoRegistro}/movimenti/count`
    const response = await this.get(
      `${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}${query ? `?${query}` : ''}`,
      tenantId,
      contesto
    )
    return Number(response.data)
  }

  /** `GET /operatore/{identificativo_registro}/movimento/{anno}/{progressivo}` (righe 792-914). */
  async dettaglioMovimentoPerAnnoProgressivo(
    identificativoRegistro: string,
    anno: number,
    progressivo: number,
    opzioni?: { variazioni?: boolean },
    tenantId?: string
  ): Promise<MovimentoDettaglioModel> {
    const query = opzioni?.variazioni === false ? '?variazioni=false' : ''
    const contesto = `/operatore/${identificativoRegistro}/movimento/${anno}/${progressivo}`
    const response = await this.get(
      `${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}${query}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /** `GET /operatore/{identificativo_registro}/movimento/{identificativo_movimento}` (righe 914-1026). */
  async dettaglioMovimentoPerIdentificativo(
    identificativoRegistro: string,
    identificativoMovimento: string,
    opzioni?: { variazioni?: boolean },
    tenantId?: string
  ): Promise<MovimentoDettaglioModel> {
    const query = opzioni?.variazioni === false ? '?variazioni=false' : ''
    const contesto = `/operatore/${identificativoRegistro}/movimento/${identificativoMovimento}`
    const response = await this.get(
      `${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}${query}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `POST /operatore/{identificativo_registro}/valida` (righe 1026-1151):
   * validazione strutturale del registro cronologico locale in formato XML
   * (o ZIP contenente l'XML). **ASYNC**, stesso ciclo di {@link inviaMovimenti}.
   */
  async validaRegistro(
    identificativoRegistro: string,
    richiesta: { fileContentBase64: string; nomeFile: string; mime: string },
    opzioni?: { replyTo?: string },
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = `/operatore/${identificativoRegistro}/valida`
    const corpo = {
      file_content: richiesta.fileContentBase64,
      nome_file: richiesta.nomeFile,
      mime: richiesta.mime,
    }
    const response = await this.post(
      `${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}`,
      corpo,
      contesto,
      opzioni,
      tenantId
    )
    const urlStato = (response.headers?.location ?? response.headers?.Location) as
      | string
      | undefined
    return { transazioneId: response.data?.transazione_id, urlStato }
  }

  /**
   * `GET /{identificativo_registro}/last-transazione-id` (righe 15-83):
   * riferimento all'ultima trasmissione di registrazioni per il registro.
   * `null` se non e' mai stata inviata alcuna trasmissione (204 No Content).
   */
  async ultimaTransazioneId(
    identificativoRegistro: string,
    tenantId?: string
  ): Promise<string | null> {
    const contesto = `/${identificativoRegistro}/last-transazione-id`
    const url = `${this.config.baseUrl}${RentriRegistriClient.DATI_REGISTRI_PATH}${contesto}`
    const headers = await this.buildAuthHeaders(tenantId)
    const response = await firstValueFrom(
      this.httpService.get(url, { headers, timeout: this.timeout, validateStatus: () => true })
    )
    if (response.status === 204) return null
    return response.data?.transazione_id ?? null
  }

  /**
   * Attende l'esito di una transazione creata da {@link inviaMovimenti} o
   * {@link validaRegistro}, seguendo il ciclo NONBLOCK_PULL su QUESTO
   * servizio (`/dati-registri/v1.0/{transazione_id}/status|result`) — v.
   * {@link RentriTrasmissioniClient.attendiEsitoEstrazione} per lo stesso
   * principio, versione slim senza rate limiter dedicato.
   */
  async attendiEsito(
    transazioneId: string,
    opzioni?: { intervalloMs?: number; maxTentativi?: number },
    tenantId?: string
  ): Promise<unknown> {
    const intervalloMs = opzioni?.intervalloMs ?? RentriRegistriClient.INTERVALLO_POLLING_DEFAULT_MS
    const maxTentativi = opzioni?.maxTentativi ?? RentriRegistriClient.MAX_TENTATIVI_POLLING_DEFAULT

    if (maxTentativi < 1) {
      throw new Error('maxTentativi deve essere almeno 1')
    }

    for (let tentativo = 1; tentativo <= maxTentativi; tentativo++) {
      const stato = await this.interrogaStatoTransazione(transazioneId, tenantId)

      if (stato.pronto) {
        const esito = await this.leggiEsitoTransazione(stato.urlEsito, tenantId)
        if (esito !== null) return esito
      }

      if (tentativo < maxTentativi) {
        await attendiMs(intervalloMs)
      }
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${maxTentativi}) in attesa dell'esito della transazione RENTRI ${transazioneId}.`
    )
  }

  private queryFiltri(filtri?: FiltriMovimenti): string {
    const query = new URLSearchParams()
    filtri?.identificativiMovimento?.forEach(id => query.append('identificativi_movimento', id))
    if (filtri?.anno !== undefined) query.set('anno', String(filtri.anno))
    if (filtri?.progressivo !== undefined) query.set('progressivo', String(filtri.progressivo))
    if (filtri?.annullato !== undefined) query.set('annullato', String(filtri.annullato))
    if (filtri?.rettificato !== undefined) query.set('rettificato', String(filtri.rettificato))
    return query.toString()
  }

  private async interrogaStatoTransazione(
    transazioneId: string,
    tenantId?: string
  ): Promise<{ pronto: boolean; urlEsito?: string }> {
    const url = `${this.config.baseUrl}${RentriRegistriClient.DATI_REGISTRI_PATH}/${transazioneId}/status`
    const contesto = `/${transazioneId}/status`

    for (
      let tentativo = 1;
      tentativo <= RentriRegistriClient.MAX_TENTATIVI_RESILIENZA;
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
        RentriRegistriClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        {
          baseMs: RentriRegistriClient.BACKOFF_BASE_MS,
          maxMs: RentriRegistriClient.BACKOFF_MAX_MS,
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
  ): Promise<unknown | null> {
    if (!urlEsito) {
      throw new Error('Risposta 303 da /status priva di header Location')
    }
    const url = urlEsito.startsWith('http') ? urlEsito : `${this.config.baseUrl}${urlEsito}`

    for (
      let tentativo = 1;
      tentativo <= RentriRegistriClient.MAX_TENTATIVI_RESILIENZA;
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
        RentriRegistriClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        {
          baseMs: RentriRegistriClient.BACKOFF_BASE_MS,
          maxMs: RentriRegistriClient.BACKOFF_MAX_MS,
        },
        tenantId ?? this.tenantIdCorrente()
      )
    }

    throw new Error(`Superato il numero massimo di tentativi leggendo /result (${url}).`)
  }

  /** POST con Bearer self-issued + firma di integrita' Agid-JWT-Signature. 404 intercettato esplicitamente. */
  private async post(
    path: string,
    body: unknown,
    contesto: string,
    opzioni?: { replyTo?: string },
    tenantId?: string
  ) {
    const url = `${this.config.baseUrl}${path}`
    const rawBody = JSON.stringify(body)

    for (
      let tentativo = 1;
      tentativo <= RentriRegistriClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const authorization = await this.auth.creaAuthorizationHeader(
        tenantId ?? this.tenantIdCorrente()
      )
      const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authorization,
        ...integrityHeaders,
        ...(opzioni?.replyTo ? { 'X-ReplyTo': opzioni.replyTo } : {}),
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
          throw new RentriApiError(404, 'Non trovato', 'Registro non trovato', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriRegistriClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriRegistriClient.BACKOFF_BASE_MS,
            maxMs: RentriRegistriClient.BACKOFF_MAX_MS,
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
      tentativo <= RentriRegistriClient.MAX_TENTATIVI_RESILIENZA;
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
          throw new RentriApiError(
            404,
            'Non trovato',
            'Registro o registrazione non trovata',
            false
          )
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriRegistriClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          {
            baseMs: RentriRegistriClient.BACKOFF_BASE_MS,
            maxMs: RentriRegistriClient.BACKOFF_MAX_MS,
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

/** `AnnoProgressivoMovimentoModel`/`IdentificativoMovimentoModel` risolti (`IdentificativoMovimentoCompletoModel`). */
export interface NumeroRegistrazioneModel {
  anno?: number | null
  progressivo?: number | null
  identificativo?: string | null
}

/** `DatiRiferimentiCompletoModel` (sottoinsieme esposto dalla fake/dai casi d'uso attuali). */
export interface RiferimentiMovimentoModel {
  numero_registrazione?: NumeroRegistrazioneModel | null
  data_ora_registrazione?: string | null
  causale_operazione?: string | null
  causale_operazione_cs?: string | null
  numero_registrazione_di_rettifica?: NumeroRegistrazioneModel | null
  numero_registrazione_rettifica?: NumeroRegistrazioneModel | null
  identificativo_registro?: string | null
  data_creazione?: string | null
  data_trasmissione?: string | null
}

/** `DatiMovimentoModel` (righe 3080-3167). */
export interface DatiMovimentoModel {
  riferimenti?: RiferimentiMovimentoModel | null
  rifiuto?: Record<string, unknown> | null
  materiali?: Record<string, unknown> | null
  integrazione_fir?: Record<string, unknown> | null
  esito?: Record<string, unknown> | null
  produttore?: Record<string, unknown> | null
  trasportatore?: Record<string, unknown> | null
  destinatario?: Record<string, unknown> | null
  intermediario?: Record<string, unknown> | null
  intermediari?: Record<string, unknown>[] | null
  annotazioni?: string | null
  annullato: boolean
  rettificato: boolean
  trasmesso_da_soggetto_delegato?: boolean | null
}

/** `MovimentoDettaglioModel` (righe 4161-4254): come `DatiMovimentoModel`, piu' `variazioni`. */
export interface MovimentoDettaglioModel extends DatiMovimentoModel {
  variazioni?: DatiMovimentoModel[] | null
}

/** Filtri di {@link RentriRegistriClient.elencaMovimenti}/{@link RentriRegistriClient.contaMovimenti}. */
export interface FiltriMovimenti {
  identificativiMovimento?: string[]
  anno?: number
  progressivo?: number
  annullato?: boolean
  rettificato?: boolean
  paging?: {
    page?: number
    pageSize?: number
  }
}

/** Esito paginato di {@link RentriRegistriClient.elencaMovimenti}. */
export interface RisultatoElencoMovimenti {
  risultati: DatiMovimentoModel[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}
