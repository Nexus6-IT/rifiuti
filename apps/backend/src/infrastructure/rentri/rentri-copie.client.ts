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
 * Client del gruppo `Copia FIR digitale`/`Copia FIR cartaceo` del servizio
 * `formulari` di RENTRI (`docs/contracts/rentri/formulari.yaml`, righe
 * 3628-4451 e 2898-3627): la RESTITUZIONE DELLA COPIA del formulario, un
 * obbligo distinto dalla trasmissione dati (`RentriTrasmissioniClient`).
 * La copia cartacea era l'alternativa ammessa alla copia digitale fino al
 * 15/09/2026; prima di questo client nessuna chiamata verso questi path
 * esisteva nel backend.
 *
 * Limitato ai path **canonici** (non deprecati): `caricamento`, `conferma` e
 * il ciclo NONBLOCK_PULL su `/{transazione_id}/status`/`/result` — gli
 * equivalenti deprecati sotto `/copia-{cartacea,digitale}/{transazione_id}/...`
 * restano fuori dall'ambito di questo client, come già per
 * `RentriTrasmissioniClient`/le rotte deprecate di `/trasmissioni/...`.
 *
 * File separato da {@link RENTRIApiClient} (`rentri-api.client.ts`) e da
 * {@link RentriTrasmissioniClient} — stessa strategia di riuso di
 * autenticazione/resilienza tramite {@link RentriAuthService} e
 * `rentri-http-resilienza.ts`, senza duplicarle.
 *
 * - `POST caricamento` (sia digitale sia cartacea) è **ASYNC**: 202 +
 *   `TransazioneModel` + header `Location`, ciclo NONBLOCK_PULL canonico su
 *   `/{transazione_id}/status`/`/result` (stesso path base di "Crea FIR" e
 *   di `.../estrai`).
 * - `GET`/`DELETE` di elenco/dettaglio/documento e `PUT` di conferma sono
 *   **sincroni**.
 */
@Injectable()
export class RentriCopieClient {
  private readonly timeout = 30000 // 30s

  /** Path base del servizio `formulari` v1.0 (v. `RentriTrasmissioniClient`). */
  private static readonly FORMULARI_PATH = '/formulari/v1.0'

  private static readonly MAX_TENTATIVI_RESILIENZA = 5
  private static readonly BACKOFF_BASE_MS = 1000
  private static readonly BACKOFF_MAX_MS = 30000

  private static readonly PAGING_PAGE_DEFAULT = 1
  private static readonly PAGING_PAGE_SIZE_DEFAULT = 100

  /** Intervallo/tentativi di default del polling NONBLOCK_PULL di {@link attendiEsitoCaricamento}. */
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
    this.logger.setContext('RentriCopieClient')
  }

  // ---- Copia digitale -----------------------------------------------------

  /**
   * `POST /copia-digitale/caricamento/{numeroFir}` (formulari.yaml righe
   * 3731-3859): chiude il ciclo di vita del FIR inviando, da parte del
   * destinatario, il file xFIR che ne contiene le informazioni. **ASYNC** —
   * 202 Accepted, corpo `TransazioneModel`.
   *
   * `xfirBase64` e' il contenuto del file xFIR (`CopiaDigitaleModel.xfir`,
   * `format: byte`) gia' codificato base64 — nessuna validazione di
   * dimensione (limite 3 MB dichiarato dal contratto) e' applicata qui: e'
   * responsabilita' del chiamante, come in
   * {@link RentriTrasmissioniClient.estraiDatiXfir}.
   */
  async caricaCopiaDigitale(
    numeroFir: string,
    numIscrSito: string,
    xfirBase64: string,
    opzioni?: { note?: string; replyTo?: string },
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = `/copia-digitale/caricamento/${numeroFir}`
    const corpo: Record<string, unknown> = { num_iscr_sito: numIscrSito, xfir: xfirBase64 }
    if (opzioni?.note) corpo.note = opzioni.note

    return this.postAsync(contesto, corpo, opzioni?.replyTo, tenantId)
  }

  /**
   * `GET /copia-digitale/caricamento/{numIscrSito}` (formulari.yaml righe
   * 3860-3993): elenco delle copie digitali caricate dal destinatario per
   * l'unita' locale indicata.
   */
  async elencaCopieDigitaliCaricate(
    numIscrSito: string,
    filtri?: FiltriElencoCopieDigitali,
    tenantId?: string
  ): Promise<RisultatoElencoCopie<CopiaDigitaleItemModel>> {
    const contesto = `/copia-digitale/caricamento/${numIscrSito}`
    return this.elenca<CopiaDigitaleItemModel>(contesto, filtri, tenantId)
  }

  /**
   * `GET /copia-digitale/caricamento/{numIscrSito}/{identificativo}`
   * (formulari.yaml righe 3994-4049): dettaglio del caricamento.
   */
  async dettaglioCopiaDigitaleCaricata(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<CopiaDigitaleResultModel> {
    const contesto = `/copia-digitale/caricamento/${numIscrSito}/${identificativo}`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `DELETE /copia-digitale/caricamento/{numIscrSito}/{identificativo}`
   * (formulari.yaml righe 4050-4103): possibile solo se nessun soggetto ha
   * gia' confermato la presa visione — un 400 tipicamente indica proprio
   * questo.
   */
  async eliminaCopiaDigitaleCaricata(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<void> {
    const contesto = `/copia-digitale/caricamento/${numIscrSito}/${identificativo}`
    await this.delete_(`${RentriCopieClient.FORMULARI_PATH}${contesto}`, contesto, tenantId)
  }

  /**
   * `GET /copia-digitale/caricamento/{numIscrSito}/{identificativo}/documento`
   * (formulari.yaml righe 4104-4155): il file xFIR caricato.
   */
  async documentoCopiaDigitaleCaricata(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<DownloadableModel | null> {
    const contesto = `/copia-digitale/caricamento/${numIscrSito}/${identificativo}/documento`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.status === 204 ? null : response.data
  }

  /**
   * `GET /copia-digitale/conferma/{identificativoSoggetto}` (formulari.yaml
   * righe 4156-4294): copie disponibili per la conferma (o gia' confermate)
   * per il soggetto indicato (codice fiscale).
   */
  async elencaCopieDigitaliPerSoggetto(
    identificativoSoggetto: string,
    filtri?: FiltriElencoCopieDigitali,
    tenantId?: string
  ): Promise<RisultatoElencoCopie<CopiaDigitaleItemModel>> {
    const contesto = `/copia-digitale/conferma/${identificativoSoggetto}`
    return this.elenca<CopiaDigitaleItemModel>(contesto, filtri, tenantId)
  }

  /**
   * `GET /copia-digitale/conferma/{identificativoSoggetto}/{identificativo}`
   * (formulari.yaml righe 4295-4341): dettaglio della copia disponibile.
   */
  async dettaglioCopiaDigitalePerSoggetto(
    identificativoSoggetto: string,
    identificativo: string,
    tenantId?: string
  ): Promise<CopiaDigitaleResultModel> {
    const contesto = `/copia-digitale/conferma/${identificativoSoggetto}/${identificativo}`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `PUT /copia-digitale/conferma/{numIscrSito}/{identificativo}`
   * (formulari.yaml righe 4391-4451): imposta (o, con `respingi`, annulla) lo
   * stato di presa visione della copia digitale da parte del soggetto che
   * opera per `numIscrSito`. Nessun corpo — solo query `ruolo`/`respingi`.
   */
  async confermaCopiaDigitale(
    numIscrSito: string,
    identificativo: string,
    opzioni?: { ruolo?: string; respingi?: boolean },
    tenantId?: string
  ): Promise<void> {
    const query = new URLSearchParams()
    if (opzioni?.ruolo) query.set('ruolo', opzioni.ruolo)
    if (opzioni?.respingi !== undefined) query.set('respingi', String(opzioni.respingi))
    const qs = query.toString()

    const contesto = `/copia-digitale/conferma/${numIscrSito}/${identificativo}`
    await this.put(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}${qs ? `?${qs}` : ''}`,
      contesto,
      tenantId
    )
  }

  // ---- Copia cartacea ------------------------------------------------------

  /**
   * `POST /copia-cartacea/caricamento/{numIscrSito}` (formulari.yaml righe
   * 3001-3096): acquisisce la richiesta di restituzione della copia del FIR
   * cartaceo. **ASYNC** — 202 Accepted, corpo `TransazioneModel`.
   *
   * A differenza della digitale, qui `numIscrSito` e' l'unita' locale del
   * TRASPORTATORE che carica (path), e `corpo.numero_fir` (dentro
   * `CopiaCartaceaModel`) identifica il FIR — non il contrario.
   */
  async caricaCopiaCartacea(
    numIscrSito: string,
    corpo: CopiaCartaceaCorpo,
    opzioni?: { replyTo?: string },
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const contesto = `/copia-cartacea/caricamento/${numIscrSito}`
    return this.postAsync(
      contesto,
      corpo as unknown as Record<string, unknown>,
      opzioni?.replyTo,
      tenantId
    )
  }

  /**
   * `GET /copia-cartacea/caricamento/{numIscrSito}` (formulari.yaml righe
   * 3097-3194): elenco delle copie cartacee caricate dal trasportatore.
   */
  async elencaCopieCartaceeCaricate(
    numIscrSito: string,
    filtri?: FiltriElencoCopieCartacee,
    tenantId?: string
  ): Promise<RisultatoElencoCopie<CopiaCartaceaResultModel>> {
    const contesto = `/copia-cartacea/caricamento/${numIscrSito}`
    return this.elenca<CopiaCartaceaResultModel>(contesto, filtri, tenantId)
  }

  /**
   * `GET /copia-cartacea/caricamento/{numIscrSito}/{identificativo}`
   * (formulari.yaml righe 3195-3250): dettaglio del caricamento.
   */
  async dettaglioCopiaCartaceaCaricata(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<CopiaCartaceaResultModel> {
    const contesto = `/copia-cartacea/caricamento/${numIscrSito}/${identificativo}`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `DELETE /copia-cartacea/caricamento/{numIscrSito}/{identificativo}`
   * (formulari.yaml righe 3251-3304): possibile solo se nessun soggetto ha
   * gia' confermato la presa in carico.
   */
  async eliminaCopiaCartaceaCaricata(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<void> {
    const contesto = `/copia-cartacea/caricamento/${numIscrSito}/${identificativo}`
    await this.delete_(`${RentriCopieClient.FORMULARI_PATH}${contesto}`, contesto, tenantId)
  }

  /**
   * `GET /copia-cartacea/caricamento/{numIscrSito}/{identificativo}/documento`
   * (formulari.yaml righe 3305-3356): il file caricato.
   */
  async documentoCopiaCartaceaCaricata(
    numIscrSito: string,
    identificativo: string,
    tenantId?: string
  ): Promise<DownloadableModel | null> {
    const contesto = `/copia-cartacea/caricamento/${numIscrSito}/${identificativo}/documento`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.status === 204 ? null : response.data
  }

  /**
   * `GET /copia-cartacea/conferma/{identificativoSoggetto}` (formulari.yaml
   * righe 3357-3481): copie cartacee disponibili per il soggetto indicato.
   */
  async elencaCopieCartaceePerSoggetto(
    identificativoSoggetto: string,
    filtri?: FiltriElencoCopieCartacee,
    tenantId?: string
  ): Promise<RisultatoElencoCopie<CopiaCartaceaResultModel>> {
    const contesto = `/copia-cartacea/conferma/${identificativoSoggetto}`
    return this.elenca<CopiaCartaceaResultModel>(contesto, filtri, tenantId)
  }

  /**
   * `PUT /copia-cartacea/conferma/{identificativoSoggetto}` (formulari.yaml
   * righe 3482-3531): pone in stato "confermata" la copia indicata nel
   * corpo (`CopiaCartaceaConfermaModel`), a differenza della digitale dove
   * la conferma non ha corpo.
   */
  async confermaCopiaCartacea(
    identificativoSoggetto: string,
    corpo: CopiaCartaceaConfermaCorpo,
    tenantId?: string
  ): Promise<void> {
    const contesto = `/copia-cartacea/conferma/${identificativoSoggetto}`
    await this.putConCorpo(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      corpo,
      contesto,
      tenantId
    )
  }

  /**
   * `GET /copia-cartacea/conferma/{identificativoSoggetto}/{identificativo}`
   * (formulari.yaml righe 3532-3578): dettaglio della copia disponibile.
   */
  async dettaglioCopiaCartaceaPerSoggetto(
    identificativoSoggetto: string,
    identificativo: string,
    tenantId?: string
  ): Promise<CopiaCartaceaResultModel> {
    const contesto = `/copia-cartacea/conferma/${identificativoSoggetto}/${identificativo}`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.data
  }

  /**
   * `GET /copia-cartacea/conferma/{identificativoSoggetto}/{identificativo}/documento`
   * (formulari.yaml righe 3579-3627): il file caricato dal trasportatore.
   */
  async documentoCopiaCartaceaPerSoggetto(
    identificativoSoggetto: string,
    identificativo: string,
    tenantId?: string
  ): Promise<DownloadableModel | null> {
    const contesto = `/copia-cartacea/conferma/${identificativoSoggetto}/${identificativo}/documento`
    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}`,
      tenantId,
      contesto
    )
    return response.status === 204 ? null : response.data
  }

  // ---- Ciclo NONBLOCK_PULL condiviso ---------------------------------------

  /**
   * Attende l'esito di una transazione creata da {@link caricaCopiaDigitale}
   * o {@link caricaCopiaCartacea}, seguendo il ciclo NONBLOCK_PULL canonico
   * (gli stessi path usati per "Crea FIR"/`.../estrai`, MAI quelli deprecati
   * sotto `/copia-{cartacea,digitale}/{transazione_id}/...`).
   *
   * Versione slim, come {@link RentriTrasmissioniClient.attendiEsitoEstrazione}:
   * nessun `conRateLimiter` dedicato.
   */
  async attendiEsitoCaricamento(
    transazioneId: string,
    opzioni?: { intervalloMs?: number; maxTentativi?: number },
    tenantId?: string
  ): Promise<unknown> {
    const intervalloMs = opzioni?.intervalloMs ?? RentriCopieClient.INTERVALLO_POLLING_DEFAULT_MS
    const maxTentativi = opzioni?.maxTentativi ?? RentriCopieClient.MAX_TENTATIVI_POLLING_DEFAULT

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
    const url = `${this.config.baseUrl}${RentriCopieClient.FORMULARI_PATH}/${transazioneId}/status`
    const contesto = `/${transazioneId}/status`

    for (let tentativo = 1; tentativo <= RentriCopieClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
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
        RentriCopieClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        { baseMs: RentriCopieClient.BACKOFF_BASE_MS, maxMs: RentriCopieClient.BACKOFF_MAX_MS },
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

    for (let tentativo = 1; tentativo <= RentriCopieClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
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
        RentriCopieClient.MAX_TENTATIVI_RESILIENZA,
        this.logger,
        this.metrics,
        ms => attendiMs(ms),
        { baseMs: RentriCopieClient.BACKOFF_BASE_MS, maxMs: RentriCopieClient.BACKOFF_MAX_MS },
        tenantId ?? this.tenantIdCorrente()
      )
    }

    throw new Error(`Superato il numero massimo di tentativi leggendo /result (${url}).`)
  }

  // ---- Meccanica HTTP condivisa ---------------------------------------------

  private async elenca<T>(
    contesto: string,
    filtri: FiltriElencoBase | undefined,
    tenantId?: string
  ): Promise<RisultatoElencoCopie<T>> {
    const page = filtri?.paging?.page ?? RentriCopieClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri?.paging?.pageSize ?? RentriCopieClient.PAGING_PAGE_SIZE_DEFAULT

    const query = new URLSearchParams()
    if (filtri?.numeroFir) query.set('numero_fir', filtri.numeroFir)
    if (filtri?.confermate !== undefined) query.set('confermate', String(filtri.confermate))
    const qs = query.toString()

    const response = await this.get(
      `${RentriCopieClient.FORMULARI_PATH}${contesto}${qs ? `?${qs}` : ''}`,
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
      risultati: Array.isArray(response.data) ? (response.data as T[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /**
   * POST asincrono (caricamento) con Bearer self-issued + firma di
   * integrita' Agid-JWT-Signature — stesso schema di
   * {@link RentriTrasmissioniClient.estraiDatiXfir}.
   */
  private async postAsync(
    contesto: string,
    corpo: Record<string, unknown>,
    replyTo: string | undefined,
    tenantId?: string
  ): Promise<{ transazioneId: string; urlStato?: string }> {
    const rawBody = JSON.stringify(corpo)
    const url = `${this.config.baseUrl}${RentriCopieClient.FORMULARI_PATH}${contesto}`

    for (let tentativo = 1; tentativo <= RentriCopieClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const authorization = await this.auth.creaAuthorizationHeader(
        tenantId ?? this.tenantIdCorrente()
      )
      const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: authorization,
        ...integrityHeaders,
        ...(replyTo ? { 'X-ReplyTo': replyTo } : {}),
      }

      try {
        const response = await firstValueFrom(
          this.httpService.post(url, corpo, { headers, timeout: this.timeout })
        )
        const urlStato = (response.headers?.location ?? response.headers?.Location) as
          | string
          | undefined
        return { transazioneId: response.data?.transazione_id, urlStato }
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Unita locale non trovata', false)
        }
        // 400 (modello dati non valido) non e' rimappato su un errore
        // dedicato — stesso principio di `RentriTrasmissioniClient['post']`.

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriCopieClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          { baseMs: RentriCopieClient.BACKOFF_BASE_MS, maxMs: RentriCopieClient.BACKOFF_MAX_MS },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /** GET con Bearer self-issued. 404 intercettato per un messaggio di dominio chiaro. */
  private async get(
    path: string,
    tenantId: string | undefined,
    contesto: string,
    extraHeaders?: Record<string, string>
  ) {
    const url = `${this.config.baseUrl}${path}`

    for (let tentativo = 1; tentativo <= RentriCopieClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const headers = { ...(await this.buildAuthHeaders(tenantId)), ...extraHeaders }

      try {
        return await firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Copia del FIR non trovata', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriCopieClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          { baseMs: RentriCopieClient.BACKOFF_BASE_MS, maxMs: RentriCopieClient.BACKOFF_MAX_MS },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /** DELETE con Bearer self-issued, nessuna firma (nessun corpo dichiarato dal contratto). */
  private async delete_(path: string, contesto: string, tenantId?: string): Promise<void> {
    const url = `${this.config.baseUrl}${path}`

    for (let tentativo = 1; tentativo <= RentriCopieClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const headers = await this.buildAuthHeaders(tenantId)

      try {
        await firstValueFrom(this.httpService.delete(url, { headers, timeout: this.timeout }))
        return
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Copia del FIR non trovata', false)
        }
        // 400 (es. copia gia' confermata) non e' rimappato su un errore
        // dedicato — stesso principio di `RentriTrasmissioniClient['delete_']`.

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriCopieClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          { baseMs: RentriCopieClient.BACKOFF_BASE_MS, maxMs: RentriCopieClient.BACKOFF_MAX_MS },
          tenantId ?? this.tenantIdCorrente()
        )
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /** PUT senza corpo (conferma digitale: solo query/path). */
  private async put(path: string, contesto: string, tenantId?: string): Promise<void> {
    return this.putConCorpo(path, undefined, contesto, tenantId)
  }

  /** PUT con Bearer self-issued, corpo opzionale (conferma cartacea porta `CopiaCartaceaConfermaModel`). */
  private async putConCorpo(
    path: string,
    corpo: unknown,
    contesto: string,
    tenantId?: string
  ): Promise<void> {
    const url = `${this.config.baseUrl}${path}`

    for (let tentativo = 1; tentativo <= RentriCopieClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const authorization = await this.auth.creaAuthorizationHeader(
        tenantId ?? this.tenantIdCorrente()
      )
      const headers: Record<string, string> = { Authorization: authorization }
      if (corpo !== undefined) {
        const rawBody = JSON.stringify(corpo)
        headers['Content-Type'] = 'application/json'
        Object.assign(headers, await this.signature.buildIntegrityHeaders(rawBody))
      }

      try {
        await firstValueFrom(this.httpService.put(url, corpo, { headers, timeout: this.timeout }))
        return
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') throw error

        if (risposta.status === 404) {
          this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
          throw new RentriApiError(404, 'Non trovato', 'Copia del FIR non trovata', false)
        }

        await gestisciRispostaErroreRentri(
          risposta,
          contesto,
          tentativo,
          RentriCopieClient.MAX_TENTATIVI_RESILIENZA,
          this.logger,
          this.metrics,
          ms => attendiMs(ms),
          { baseMs: RentriCopieClient.BACKOFF_BASE_MS, maxMs: RentriCopieClient.BACKOFF_MAX_MS },
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

// ---- Modelli --------------------------------------------------------------

interface FiltriElencoBase {
  numeroFir?: string
  confermate?: boolean
  paging?: { page?: number; pageSize?: number }
}

/** Filtri di {@link RentriCopieClient.elencaCopieDigitaliCaricate}/{@link RentriCopieClient.elencaCopieDigitaliPerSoggetto}. */
export type FiltriElencoCopieDigitali = FiltriElencoBase

/** Filtri di {@link RentriCopieClient.elencaCopieCartaceeCaricate}/{@link RentriCopieClient.elencaCopieCartaceePerSoggetto}. */
export type FiltriElencoCopieCartacee = FiltriElencoBase

/** Esito paginato condiviso da tutti gli elenchi di questo client. */
export interface RisultatoElencoCopie<T> {
  risultati: T[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}

/** `CopiaDigitaleRuoloResult`/`CopiaDigitaleRuoloItemResult` (formulari.yaml righe 6766-6816). */
export interface CopiaDigitaleRuoloModel {
  codice_fiscale?: string | null
  denominazione?: string | null
  num_iscr_sito?: string | null
  num_iscr_sito_conferma?: string | null
  data_conferma?: string | null
  via?: string | null
  civico?: string | null
  comune_id?: string | null
}

/** `CopiaDigitaleItemResult` (elenco, formulari.yaml righe 6617-6671). */
export interface CopiaDigitaleItemModel {
  identificativo?: string | null
  numero_fir?: string | null
  data_emissione?: string | null
  data_caricamento?: string | null
  tipo_accettazione?: 'A' | 'P' | 'R' | null
  is_confermata?: boolean | null
  note?: string | null
  produttore?: CopiaDigitaleRuoloModel | null
  trasportatori?: CopiaDigitaleRuoloModel[] | null
  intermediari?: CopiaDigitaleRuoloModel[] | null
}

/** `CopiaDigitaleResult` (dettaglio, formulari.yaml righe 6691-6757). */
export interface CopiaDigitaleResultModel {
  identificativo?: string | null
  numero_fir?: string | null
  data_emissione?: string | null
  num_iscr_sito?: string | null
  produttore?: CopiaDigitaleRuoloModel | null
  destinatari?: CopiaDigitaleRuoloModel[] | null
  trasportatori?: CopiaDigitaleRuoloModel[] | null
  intermediari?: CopiaDigitaleRuoloModel[] | null
  note?: string | null
  data_caricamento?: string | null
  codice_fiscale_caricamento?: string | null
  denominazione_caricamento?: string | null
  emesso_da_identificativo?: string | null
  emesso_da_denominazione?: string | null
}

/** `CopiaCartaceaSoggettoInfo` (formulari.yaml righe 6534-6592), corpo di `caricaCopiaCartacea`. */
export interface CopiaCartaceaSoggettoInfoCorpo {
  codice_fiscale: string
  denominazione: string
  nazione_id?: string
  num_iscr_sito?: string
}

/** `CopiaCartaceaModel` (formulari.yaml righe 6381-6439), corpo di {@link RentriCopieClient.caricaCopiaCartacea}. */
export interface CopiaCartaceaCorpo {
  file_content: string
  nome_file: string
  mime: string
  numero_fir: string
  data_emissione: string
  produttore: CopiaCartaceaSoggettoInfoCorpo
  trasportatori?: CopiaCartaceaSoggettoInfoCorpo[]
  intermediari?: CopiaCartaceaSoggettoInfoCorpo[]
  note?: string
}

/** `CopiaCartaceaConfermaModel` (formulari.yaml righe 6359-6380), corpo di {@link RentriCopieClient.confermaCopiaCartacea}. */
export interface CopiaCartaceaConfermaCorpo {
  identificativo: string
  num_iscr_sito?: string
  ruolo?: 'Produttore' | 'Trasportatore' | 'Intermediario'
  respingi?: boolean
}

/** `CopiaCartaceaRuoloResult` (formulari.yaml righe 6513-6533). */
export interface CopiaCartaceaRuoloModel {
  codice_fiscale?: string | null
  denominazione?: string | null
  num_iscr_sito?: string | null
  data_conferma?: string | null
}

/** `CopiaCartaceaResult` (formulari.yaml righe 6440-6512), usato sia per elenco che dettaglio. */
export interface CopiaCartaceaResultModel {
  identificativo?: string | null
  numero_fir?: string | null
  data_emissione?: string | null
  num_iscr_sito?: string | null
  produttore?: CopiaCartaceaRuoloModel | null
  trasportatori?: CopiaCartaceaRuoloModel[] | null
  intermediari?: CopiaCartaceaRuoloModel[] | null
  note?: string | null
  data_caricamento?: string | null
  num_iscr_sito_caricamento?: string | null
  codice_fiscale_caricamento?: string | null
  denominazione_caricamento?: string | null
  emesso_da_identificativo?: string | null
  emesso_da_denominazione?: string | null
}

/** `DownloadableBaseResponse` (formulari.yaml righe 9140-9156). */
export interface DownloadableModel {
  nome_file?: string | null
  mime?: string | null
  content?: string | null
}
