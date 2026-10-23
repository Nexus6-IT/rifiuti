import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { AxiosResponse } from 'axios'
import { LoggerService } from '../../../core/logger/logger.service'
import { MetricsService } from '../../../core/metrics/metrics.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from '../rentri-config'
import { RentriAuthService } from '../rentri-auth.service'
import { RentriSignatureService } from '../rentri-signature.service'
import { gestisciRispostaErroreRentri, attendiMs } from '../rentri-http-resilienza'

/**
 * Client del servizio `formulari` di RENTRI, limitato alle operazioni sul
 * contenitore xFIR (`docs/contracts/rentri/formulari.yaml`):
 * - `POST /formulari/v1.0/xfir/valida` (righe 5981-6047): valida un xFIR
 *   "dell'ente" (non necessariamente gia' associato a un formulario).
 * - `POST /formulari/v1.0/{numero_fir}/xfir` (righe 2681-2743): carica un
 *   xFIR esterno per un formulario specifico.
 * - `GET /formulari/v1.0/{numero_fir}/xfir` (righe 2625-2680): scarica l'xFIR
 *   di un formulario. **SINCRONO** (200 diretto, `DownloadableBaseResponse`)
 *   — a differenza delle due `POST` sopra, NON e' NONBLOCK_PULL.
 *
 * Le due `POST` sono invece entrambe `🔁[ASYNC]`: risposta 202 con
 * `TransazioneModel.transazione_id` + header `Location`, esito da recuperare
 * col ciclo NONBLOCK_PULL (`GET /{transazione_id}/status` → 200 "in corso" /
 * 303 "pronto" → `GET` sul `Location` ricevuto → `EsitoValidazioneXfirModel`
 * o `EsitoUploadXfirResultModel`).
 *
 * **Duplica deliberatamente** il ciclo di polling gia' implementato in
 * `RENTRIApiClient.attendiEsito` (stesso servizio `formulari`, stesso
 * contratto per `/status`/`/result`): quel client e' esplicitamente fuori
 * dall'ambito di questo task (v. istruzioni — "NON toccare
 * rentri-api.client.ts") e le sue rispettive fasi di polling sono metodi
 * `private`, non riusabili da qui senza modificarlo. La duplicazione e'
 * accettata come costo di quel vincolo, non come svista.
 *
 * Autenticazione: come {@link RentriAuthService} (Bearer self-issued
 * ID_AUTH_REST_02) + firma di integrita' `Agid-JWT-Signature`
 * ({@link RentriSignatureService}) su OGNI richiesta con body (le due `POST`,
 * non la `GET`) — stesso schema di `RENTRIApiClient.post`/`get`.
 */
@Injectable()
export class RentriXfirClient {
  private readonly timeout = 30000 // 30s

  /**
   * Path base del servizio `formulari` v1.0, confermato da
   * `docs/contracts/rentri/formulari.yaml` (`servers[0].url`). Le rotte
   * `xfir` di questo client vivono TUTTE sotto questo stesso servizio
   * (confermato anche dal finto: `tools/rentri-fake/src/routes/xfir.ts`
   * usa lo stesso `PREFISSO = '/formulari/v1.0'` delle altre rotte
   * `formulari`).
   */
  private static readonly FORMULARI_PATH = '/formulari/v1.0'

  private static readonly MAX_TENTATIVI_RESILIENZA = 5
  private static readonly BACKOFF_BASE_MS = 1000
  private static readonly BACKOFF_MAX_MS = 30000
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
    this.logger.setContext('RentriXfirClient')
  }

  /**
   * `POST /xfir/valida`: apre la validazione di un xFIR "dell'ente" (non
   * necessariamente gia' presente in RENTRI — `ValidazioneXfirResult`
   * riporta `formulario_presente_in_rentri` per distinguerlo). Il campo
   * `xfir` (`ValidaXfirModel`, formulari.yaml righe 10478-10487) e' il
   * contenuto del container ASiC-E in base64 (`format: byte`) — v.
   * {@link costruisciAsicE} in `costruisci-asice.ts` per come produrlo.
   */
  async validaXfir(
    tenantId: string,
    xfirBase64: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = '/formulari (xfir/valida)'
    const risposta = await this.eseguiConResilienza(
      () =>
        this.post(`${RentriXfirClient.FORMULARI_PATH}/xfir/valida`, { xfir: xfirBase64 }, tenantId),
      contesto,
      tenantId
    )
    return this.leggiTransazioneModel(risposta, contesto)
  }

  /**
   * `POST /{numero_fir}/xfir`: carica un xFIR esterno per il formulario
   * indicato. `UploadXfirModel` (formulari.yaml righe 10462-10477): sia
   * `numIscrSito` sia `xfir` sono obbligatori dal contratto — il finto
   * (`routes/xfir.ts`) rifiuta con 400 se uno dei due manca, replicato qui
   * come precondizione lato client per non spedire una richiesta gia' nota
   * come invalida.
   */
  async caricaXfir(
    tenantId: string,
    numeroFir: string,
    numIscrSito: string,
    xfirBase64: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    if (!numIscrSito || !xfirBase64) {
      throw new Error(
        "caricaXfir richiede sia 'numIscrSito' sia 'xfirBase64' (UploadXfirModel: entrambi obbligatori)."
      )
    }

    const contesto = `/formulari/${numeroFir}/xfir (upload)`
    const risposta = await this.eseguiConResilienza(
      () =>
        this.post(
          `${RentriXfirClient.FORMULARI_PATH}/${numeroFir}/xfir`,
          { num_iscr_sito: numIscrSito, xfir: xfirBase64 },
          tenantId
        ),
      contesto,
      tenantId
    )
    return this.leggiTransazioneModel(risposta, contesto)
  }

  /**
   * `GET /{numero_fir}/xfir`: scarica l'xFIR corrente del formulario.
   * **SINCRONO** (200 diretto, `DownloadableBaseResponse` — formulari.yaml
   * righe 2651-2657), a differenza di {@link validaXfir}/{@link caricaXfir}.
   * `identificativoDestinatario`, se indicato, filtra l'xFIR alle sole
   * informazioni coperte da firme riconducibili a quel destinatario (righe
   * 2643-2650) — omesso di default (xFIR completo).
   */
  async scaricaXfir(
    tenantId: string,
    numeroFir: string,
    identificativoDestinatario?: string
  ): Promise<XfirScaricato> {
    const query = identificativoDestinatario
      ? `?identificativo_destinatario=${encodeURIComponent(identificativoDestinatario)}`
      : ''
    const contesto = `/formulari/${numeroFir}/xfir (download)`
    const risposta = await this.eseguiConResilienza(
      () => this.get(`${RentriXfirClient.FORMULARI_PATH}/${numeroFir}/xfir${query}`, tenantId),
      contesto,
      tenantId
    )

    return {
      nomeFile: risposta.data?.nome_file ?? undefined,
      mime: risposta.data?.mime ?? undefined,
      contenutoBase64: risposta.data?.content ?? undefined,
    }
  }

  /**
   * Attende l'esito di una transazione aperta da {@link validaXfir} o
   * {@link caricaXfir}, seguendo lo stesso ciclo NONBLOCK_PULL documentato da
   * `RENTRIApiClient.attendiEsito` (formulari.yaml righe 2801-2897): `GET
   * /{transazione_id}/status` con `maxRedirects: 0` — 200 senza corpo = "in
   * elaborazione" (si ripete dopo `intervalloMs`), 303 con `Location` =
   * pronto; si segue quel `Location` e un 400 li' significa "richiesta
   * anticipata" (si continua il polling), qualsiasi altro corpo e' l'esito.
   */
  async attendiEsitoValidazione(
    tenantId: string,
    transazioneId: string,
    opzioni?: OpzioniPollingXfir
  ): Promise<EsitoValidazioneXfir> {
    const intervalloMs = opzioni?.intervalloMs ?? RentriXfirClient.INTERVALLO_POLLING_DEFAULT_MS
    const maxTentativi = opzioni?.maxTentativi ?? RentriXfirClient.MAX_TENTATIVI_POLLING_DEFAULT

    if (maxTentativi < 1) {
      throw new Error('maxTentativi deve essere almeno 1')
    }

    for (let tentativo = 1; tentativo <= maxTentativi; tentativo++) {
      const stato = await this.interrogaStatoTransazione(tenantId, transazioneId)

      if (stato.pronto) {
        const esito = await this.leggiEsitoTransazione(tenantId, stato.urlEsito)
        if (esito !== null) {
          return esito
        }
      }

      if (tentativo < maxTentativi) {
        await attendiMs(intervalloMs)
      }
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${maxTentativi}) in attesa dell'esito della transazione xFIR ${transazioneId}.`
    )
  }

  private leggiTransazioneModel(
    risposta: AxiosResponse,
    contesto: string
  ): { transazioneId: string; urlStato?: string } {
    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }
    const urlStato = (risposta.headers?.location ?? risposta.headers?.Location) as
      | string
      | undefined
    return { transazioneId, urlStato }
  }

  private async interrogaStatoTransazione(
    tenantId: string,
    transazioneId: string
  ): Promise<{ pronto: boolean; urlEsito?: string }> {
    const url = `${this.config.baseUrl}${RentriXfirClient.FORMULARI_PATH}/${transazioneId}/status`

    for (let tentativo = 1; tentativo <= RentriXfirClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const headers = await this.buildAuthHeaders(tenantId)
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers,
          timeout: this.timeout,
          maxRedirects: 0,
          validateStatus: () => true,
        })
      )

      if (response.status === 200) {
        return { pronto: false }
      }
      if (response.status === 303) {
        const urlEsito = (response.headers?.location ?? response.headers?.Location) as string
        return { pronto: true, urlEsito }
      }

      await this.gestisciRispostaNonPrevista(
        response,
        `/status (transazione ${transazioneId})`,
        tentativo,
        tenantId
      )
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${RentriXfirClient.MAX_TENTATIVI_RESILIENZA}) interrogando /status per la transazione ${transazioneId}.`
    )
  }

  private async leggiEsitoTransazione(
    tenantId: string,
    urlEsito?: string
  ): Promise<EsitoValidazioneXfir | null> {
    if (!urlEsito) {
      throw new Error('Risposta 303 da /status priva di header Location')
    }

    const url = urlEsito.startsWith('http') ? urlEsito : `${this.config.baseUrl}${urlEsito}`

    for (let tentativo = 1; tentativo <= RentriXfirClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const headers = await this.buildAuthHeaders(tenantId)
      const response = await firstValueFrom(
        this.httpService.get(url, { headers, timeout: this.timeout, validateStatus: () => true })
      )

      if (response.status === 400) {
        return null
      }
      if (response.status === 200) {
        return response.data
      }

      await this.gestisciRispostaNonPrevista(response, '/result', tentativo, tenantId)
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${RentriXfirClient.MAX_TENTATIVI_RESILIENZA}) leggendo /result (${url}).`
    )
  }

  private async gestisciRispostaNonPrevista(
    risposta: { status: number; headers?: Record<string, unknown>; data?: unknown },
    contesto: string,
    tentativo: number,
    tenantId?: string
  ): Promise<'ritenta'> {
    return gestisciRispostaErroreRentri(
      risposta,
      contesto,
      tentativo,
      RentriXfirClient.MAX_TENTATIVI_RESILIENZA,
      this.logger,
      this.metrics,
      ms => attendiMs(ms),
      { baseMs: RentriXfirClient.BACKOFF_BASE_MS, maxMs: RentriXfirClient.BACKOFF_MAX_MS },
      tenantId ?? this.tenantIdCorrente()
    )
  }

  private async eseguiConResilienza(
    azione: () => Promise<AxiosResponse>,
    contesto: string,
    tenantId?: string
  ): Promise<AxiosResponse> {
    const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
    for (let tentativo = 1; tentativo <= RentriXfirClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      try {
        return await azione()
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') {
          throw error
        }
        await this.gestisciRispostaNonPrevista(risposta, contesto, tentativo, tenantEffettivo)
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /**
   * POST con autenticazione ID_AUTH_REST_02 + firma di integrita'
   * `Agid-JWT-Signature` sul body — stesso schema di `RENTRIApiClient.post`
   * (imitato, non riusato: quel metodo e' `private`).
   */
  private async post(path: string, body: unknown, tenantId?: string): Promise<AxiosResponse> {
    const url = `${this.config.baseUrl}${path}`
    const rawBody = JSON.stringify(body)

    // Stesso tenant effettivo per Bearer e firma di integrità.
    const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
    const authorization = await this.auth.creaAuthorizationHeader(tenantEffettivo)
    const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody, tenantEffettivo)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: authorization,
      ...integrityHeaders,
    }

    return firstValueFrom(this.httpService.post(url, body, { headers, timeout: this.timeout }))
  }

  /** GET con Bearer self-issued — stesso schema di `RentriAnagraficheClient.get`. */
  private async get(path: string, tenantId?: string): Promise<AxiosResponse> {
    const url = `${this.config.baseUrl}${path}`
    const headers = await this.buildAuthHeaders(tenantId)
    return firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
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

/** `DownloadableBaseResponse` (formulari.yaml righe 9140-9156), tutti i campi nullable per contratto. */
export interface XfirScaricato {
  nomeFile?: string
  mime?: string
  contenutoBase64?: string
}

/** Messaggio di validazione (`EsitoMessaggioModel`), stessa forma usata dal finto (`routes/xfir.ts`). */
export interface MessaggioValidazioneXfir {
  campo?: string
  tipo?: string
  codice_messaggio?: string
}

/**
 * Esito NONBLOCK_PULL di {@link RentriXfirClient.validaXfir} /
 * {@link RentriXfirClient.caricaXfir} (`EsitoValidazioneXfirModel` /
 * `EsitoUploadXfirResultModel` — stessa forma minima usata da entrambi:
 * `transazione_id`, `errore`, `validazione`). Il campo polimorfo `esito`
 * (`EsitoValidaXfirModel`/`EsitoUploadXfirModel`, con `result` ricco —
 * `ValidazioneXfirResult`) NON e' modellato qui: nessun chiamante attuale ne
 * ha bisogno, e dichiararlo senza un caso d'uso reale rischierebbe di
 * indovinarne la forma invece di verificarla.
 */
export interface EsitoValidazioneXfir {
  transazione_id: string
  errore: boolean
  validazione?: MessaggioValidazioneXfir[]
}

export interface OpzioniPollingXfir {
  intervalloMs?: number
  maxTentativi?: number
}
