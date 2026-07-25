import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import type { AxiosResponse } from 'axios'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { firstValueFrom } from 'rxjs'
import { TenantContext } from '../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriAuthService } from './rentri-auth.service'
import { RentriSignatureService } from './rentri-signature.service'

/**
 * RENTRI API Client
 *
 * Comunica con l'API RENTRI in due modalità (vedi {@link RentriConfig}):
 * - `mock` → mock locale (`tools/rentri-mock`), autenticazione con X-API-Key.
 * - `live` → ambiente reale RENTRI (demo/prod) con autenticazione ID_AUTH_REST_02
 *   del Modello di Interoperabilità AgID: JWT self-issued Bearer, firmato ad
 *   ogni chiamata (vedi {@link RentriAuthService}), e firma di integrità
 *   `Agid-JWT-Signature` su ogni richiesta con body (vedi {@link RentriSignatureService}).
 *
 * Formato dati: xFIR secondo le specifiche tecniche D.M. 59/2023 (Decreto
 * Ministeriale, allegato tecnico RENTRI). Il corpo della richiesta segue la
 * struttura xFIR: `produttore`, `trasportatore`, `destinatario`, `rifiuto`,
 * `trasporto`, `firmeDigitali`. Questo formato "flat" resta usato SOLO dai
 * metodi legacy in modalità `mock` (verso `tools/rentri-mock`); i metodi
 * allineati al contratto ufficiale (`creaFormulario`, `leggiFormulario`)
 * parlano invece i modelli del contratto (`NuovoFormularioModel`,
 * `DettaglioFormulario`).
 *
 * Servizio API RENTRI confermato dal contratto ufficiale
 * (`docs/contracts/rentri/formulari.yaml`, `servers[0].url`): `formulari`
 * v1.0, base `https://demoapi.rentri.gov.it/formulari/v1.0` (demo) /
 * `https://api.rentri.gov.it/formulari/v1.0` (prod). La creazione di un FIR
 * è `POST /` (radice del servizio, non `/formulari`): risposta 202 con
 * `TransazioneModel.transazione_id` e header `Location` verso lo stato della
 * transazione — v. `creaFormulario`. Il polling della transazione è task
 * successivo.
 *
 * ATTIVARE: caricare certificato + completare iscrizione RENTRI (area operatori).
 */
@Injectable()
export class RENTRIApiClient {
  private readonly timeout = 30000 // 30s

  /**
   * Path base del servizio `formulari` v1.0, confermato da
   * `docs/contracts/rentri/formulari.yaml` (`servers[0].url`). Va concatenato
   * a `config.baseUrl` (solo host, es. `https://demoapi.rentri.gov.it`).
   */
  private static readonly FORMULARI_PATH = '/formulari/v1.0'

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly auth: RentriAuthService,
    private readonly signature: RentriSignatureService
  ) {
    this.logger.setContext('RENTRIApiClient')
  }

  private get isLive(): boolean {
    return this.config.mode === 'live'
  }

  /**
   * Submit FIR to RENTRI
   *
   * Disponibile SOLO in modalità `mock` (verso `tools/rentri-mock`, endpoint
   * REST sincrono legacy). Il contratto ufficiale RENTRI non espone alcuna
   * sottomissione sincrona: la creazione reale di un FIR è asincrona
   * (`POST /` → 202 + polling) — v. {@link creaFormulario}.
   */
  async submitFIR(fir: any): Promise<RENTRISubmitResponse> {
    if (this.isLive) {
      throw new Error(
        'submitFIR non è disponibile in modalità live: il contratto ufficiale RENTRI (formulari.yaml) non espone un endpoint di sottomissione sincrona. Usare creaFormulario (POST asincrono, 202 + transazione_id) seguito dal polling dello stato della transazione.'
      )
    }

    const startTime = Date.now()
    const xFIR = this.convertToXFIRFormat(fir)
    const path = '/api/v1/fir/submit'

    try {
      this.logger.info('Submitting FIR to RENTRI', {
        firId: fir.id,
        firNumber: fir.firNumber,
        mode: this.config.mode,
      })

      const response = await this.post(path, xFIR, '/fir/submit')
      const duration = Date.now() - startTime

      this.metrics.rentriApiRequestDuration.observe(
        { endpoint: '/fir/submit', status: 'success' },
        duration / 1000
      )

      this.logger.info('FIR submitted to RENTRI successfully', {
        firId: fir.id,
        rentriId: response.data.rentriId,
        protocolNumber: response.data.protocolNumber,
        duration,
      })

      return {
        success: true,
        protocolNumber: response.data.protocolNumber,
        rentriId: response.data.rentriId,
        receivedAt: response.data.receivedAt,
      }
    } catch (error: any) {
      // Handle RENTRI validation errors
      if (error.response?.status === 400) {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'VALIDATION_ERROR',
        })

        this.logger.warn('RENTRI validation error', {
          firId: fir.id,
          errors: error.response.data.errors,
        })

        return {
          success: false,
          errors: error.response.data.errors || [],
        }
      }

      // Handle service unavailable
      if (error.response?.status === 503) {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'SERVICE_UNAVAILABLE',
        })

        const retryAfter = error.response.data?.retryAfter || 300

        this.logger.error('RENTRI service unavailable', error, {
          firId: fir.id,
          retryAfter,
        })

        throw new Error(`RENTRI service temporarily unavailable. Retry after ${retryAfter}s`)
      }

      // Handle timeout
      if (error.code === 'ECONNABORTED') {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'TIMEOUT',
        })

        this.logger.error('RENTRI API timeout', error, {
          firId: fir.id,
          timeout: this.timeout,
        })

        throw new Error('RENTRI API timeout')
      }

      this.metrics.rentriApiErrors.inc({
        endpoint: '/fir/submit',
        error_type: 'UNKNOWN',
      })

      this.logger.error('RENTRI API error', error, {
        firId: fir.id,
        error: error.message,
      })

      throw error
    }
  }

  /**
   * Validate FIR before submission
   *
   * Disponibile SOLO in modalità `mock`. Il contratto ufficiale non espone
   * un endpoint di validazione sincrona dedicato a questo flusso (esiste
   * `/xfir/valida`, ma per un caso d'uso diverso — validazione di un xFIR
   * cartaceo caricato). Gli errori di un FIR digitale emergono dall'esito
   * della transazione creata con {@link creaFormulario}.
   */
  async validateFIR(fir: any): Promise<RENTRIValidationResponse> {
    if (this.isLive) {
      throw new Error(
        "validateFIR non è disponibile in modalità live: il contratto ufficiale non espone un endpoint di validazione sincrona per questo flusso. Usare creaFormulario e leggere gli errori dall'esito della transazione."
      )
    }

    const xFIR = this.convertToXFIRFormat(fir)
    const path = '/api/v1/fir/validate'

    try {
      const response = await this.post(path, xFIR, '/fir/validate')

      return {
        valid: response.data.valid,
        errors: response.data.errors || [],
        warnings: response.data.warnings || [],
      }
    } catch (error: any) {
      this.logger.error('RENTRI validation error', error, { firId: fir.id })
      throw error
    }
  }

  /**
   * Get FIR status from RENTRI
   *
   * Disponibile SOLO in modalità `mock`. Per il dettaglio reale di un FIR
   * secondo il contratto ufficiale usare {@link leggiFormulario}
   * (`GET /{numero_fir}`).
   */
  async getFIRStatus(firId: string): Promise<RENTRIFIRStatus> {
    if (this.isLive) {
      throw new Error(
        'getFIRStatus non è disponibile in modalità live: usare leggiFormulario(tenantId, numeroFir) per il dettaglio del FIR secondo il contratto ufficiale (GET /{numero_fir}).'
      )
    }

    const path = `/api/v1/fir/${firId}`

    try {
      const response = await this.get(path)
      return response.data.data ?? response.data
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('FIR non trovato in RENTRI')
      }
      throw error
    }
  }

  /**
   * Crea un nuovo FIR (`POST /` — radice del servizio `formulari`,
   * formulari.yaml righe 187-265, NON `/formulari`).
   *
   * L'operazione è asincrona: la risposta è sempre 202 con corpo
   * `TransazioneModel` (`{ transazione_id: <uuid> }`) e un header `Location`
   * che punta a `/{transazione_id}/status`. Il polling dello stato della
   * transazione è task successivo: questo metodo si limita a restituire
   * l'identificativo e l'URL di stato così come li legge dalla risposta,
   * senza attendere l'esito dell'elaborazione.
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza}
   * (v. commento lì per il dettaglio della politica di retry).
   */
  async creaFormulario(
    tenantId: string,
    dati: NuovoFormularioPayload
  ): Promise<{ transazioneId: string; urlStato: string }> {
    const response = await this.eseguiRichiestaConResilienza(
      () => this.post(`${RENTRIApiClient.FORMULARI_PATH}/`, dati, '/formulari (crea)', tenantId),
      '/formulari (crea)'
    )

    const transazioneId = response.data?.transazione_id
    const urlStato = (response.headers?.location ?? response.headers?.Location) as string

    return { transazioneId, urlStato }
  }

  /**
   * Legge il dettaglio di un FIR (`GET /{numero_fir}` — formulari.yaml righe
   * 283-334). Risposta 200 con corpo `DettaglioFormulario`.
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza}.
   */
  async leggiFormulario(tenantId: string, numeroFir: string): Promise<FormularioModel> {
    const response = await this.eseguiRichiestaConResilienza(
      () => this.get(`${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}`, tenantId),
      `/formulari/${numeroFir}`
    )
    return response.data
  }

  /** Intervallo di default (ms) tra un tentativo e l'altro del polling NONBLOCK_PULL. */
  private static readonly INTERVALLO_POLLING_DEFAULT_MS = 2000

  /** Numero massimo di default di tentativi prima di sollevare un errore esplicito. */
  private static readonly MAX_TENTATIVI_POLLING_DEFAULT = 30

  /**
   * Attende l'esito di una transazione creata con {@link creaFormulario},
   * seguendo il ciclo NONBLOCK_PULL del contratto ufficiale
   * (formulari.yaml righe 2801-2897):
   *
   * - `GET /{transazione_id}/status`: **200 senza corpo** finché
   *   l'elaborazione è in corso (si riprova dopo `intervalloMs`); **303**
   *   con header `Location` quando l'esito è pronto.
   * - Segue il `Location` ricevuto ed esegue `GET` su `/result`: **400**
   *   significa "richiesta anticipata" (non è un errore definitivo — il
   *   ciclo continua), altrimenti il corpo è l'`EsitoFormularioModel`.
   *
   * ATTENZIONE: la richiesta a `/status` è fatta con `maxRedirects: 0` e
   * `validateStatus` permissivo. Un client HTTP che seguisse il redirect da
   * solo trasformerebbe ogni 303 in un 200 (quello finale di `/result`),
   * rendendo impossibile distinguere "in elaborazione" da "pronto".
   *
   * `opzioni.maxTentativi` impone un limite esplicito: superato, si
   * solleva un errore invece di eseguire un polling potenzialmente
   * infinito (bloccherebbe un worker della coda).
   */
  async attendiEsito(
    tenantId: string,
    transazioneId: string,
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const intervalloMs = opzioni?.intervalloMs ?? RENTRIApiClient.INTERVALLO_POLLING_DEFAULT_MS
    const maxTentativi = opzioni?.maxTentativi ?? RENTRIApiClient.MAX_TENTATIVI_POLLING_DEFAULT

    if (maxTentativi < 1) {
      throw new Error('maxTentativi deve essere almeno 1')
    }

    for (let tentativo = 1; tentativo <= maxTentativi; tentativo++) {
      const stato = await this.interrogaStatoTransazione(tenantId, transazioneId)

      if (stato.pronto) {
        const esito = await this.leggiEsitoTransazione(tenantId, stato.urlEsito)
        // `null` = /result ha risposto 400 ("richiesta anticipata"): non è un
        // errore definitivo, si continua il polling come se fosse ancora in
        // elaborazione.
        if (esito !== null) {
          return esito
        }
      }

      if (tentativo < maxTentativi) {
        await this.attendi(intervalloMs)
      }
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${maxTentativi}) in attesa dell'esito della transazione RENTRI ${transazioneId}.`
    )
  }

  /**
   * Interroga `GET /{transazione_id}/status` senza lasciare che il client
   * HTTP segua da solo un eventuale redirect (v. {@link attendiEsito}).
   *
   * La richiesta usa `validateStatus: () => true` (necessario per distinguere
   * 200 da 303 senza che axios sollevi un errore): 403/429/423/5xx arrivano
   * quindi come risposta normale, non come eccezione, e vanno riconosciuti
   * esplicitamente — v. {@link gestisciRispostaNonPrevista}.
   */
  private async interrogaStatoTransazione(
    tenantId: string,
    transazioneId: string
  ): Promise<{ pronto: boolean; urlEsito?: string }> {
    const url = `${this.config.baseUrl}${RENTRIApiClient.FORMULARI_PATH}/${transazioneId}/status`

    for (let tentativo = 1; tentativo <= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
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
        tentativo
      )
      // 'ritenta': si riprova il ciclo (l'attesa è già stata eseguita sopra).
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${RENTRIApiClient.MAX_TENTATIVI_RESILIENZA}) interrogando /status per la transazione ${transazioneId}.`
    )
  }

  /**
   * Segue il `Location` ricevuto da `/status` e legge l'esito da `/result`.
   * Restituisce `null` se il risultato non è ancora disponibile (400 —
   * "richiesta anticipata", non un errore definitivo — comportamento
   * preesistente, non toccato). 403/429/423/5xx v. {@link gestisciRispostaNonPrevista}.
   */
  private async leggiEsitoTransazione(
    tenantId: string,
    urlEsito?: string
  ): Promise<EsitoFormulario | null> {
    if (!urlEsito) {
      throw new Error('Risposta 303 da /status priva di header Location')
    }

    const url = urlEsito.startsWith('http') ? urlEsito : `${this.config.baseUrl}${urlEsito}`

    for (let tentativo = 1; tentativo <= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const headers = await this.buildAuthHeaders(tenantId)
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers,
          timeout: this.timeout,
          validateStatus: () => true,
        })
      )

      if (response.status === 400) {
        return null
      }

      if (response.status === 200) {
        return response.data
      }

      await this.gestisciRispostaNonPrevista(response, '/result', tentativo)
      // 'ritenta': si riprova il ciclo (l'attesa è già stata eseguita sopra).
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${RENTRIApiClient.MAX_TENTATIVI_RESILIENZA}) leggendo /result (${url}).`
    )
  }

  /** Attesa non bloccante tra un tentativo e l'altro del polling/retry. */
  private attendi(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /** Numero massimo di tentativi per gli errori transitori (429/423/5xx). */
  private static readonly MAX_TENTATIVI_RESILIENZA = 5

  /** Base (ms) del backoff esponenziale quando l'ente non indica `Retry-After`. */
  private static readonly BACKOFF_BASE_MS = 1000

  /** Tetto (ms) del backoff esponenziale, per non attendere indefinitamente. */
  private static readonly BACKOFF_MAX_MS = 30000

  /**
   * Estrae `title`/`detail` da un corpo `application/problem+json`
   * (`ProblemDetails`, contratto ufficiale). Sono gli UNICI campi del corpo
   * di errore che il client riporta nei log/nel log di sincronizzazione: il
   * contenuto grezzo della risposta non va mai esposto al tenant.
   */
  private estraiProblemDetails(data: unknown): { title?: string; detail?: string } {
    if (data && typeof data === 'object') {
      const problema = data as { title?: unknown; detail?: unknown }
      return {
        title: typeof problema.title === 'string' ? problema.title : undefined,
        detail: typeof problema.detail === 'string' ? problema.detail : undefined,
      }
    }
    return {}
  }

  /**
   * Calcola l'attesa (ms) prima del prossimo tentativo: rispetta l'header
   * `Retry-After` (in secondi) se presente e valido, altrimenti applica un
   * backoff esponenziale (`BACKOFF_BASE_MS * 2^(tentativo-1)`, tetto
   * `BACKOFF_MAX_MS`).
   */
  private calcolaAttesaMs(tentativo: number, retryAfterHeader?: string): number {
    if (retryAfterHeader !== undefined) {
      const secondi = Number(retryAfterHeader)
      if (!Number.isNaN(secondi) && secondi >= 0) {
        return secondi * 1000
      }
    }
    return Math.min(
      RENTRIApiClient.BACKOFF_BASE_MS * 2 ** (tentativo - 1),
      RENTRIApiClient.BACKOFF_MAX_MS
    )
  }

  /**
   * Classifica una risposta di errore RENTRI e, se transitoria, attende
   * prima del prossimo tentativo. Politica (contratto ufficiale,
   * formulari.yaml — `ProblemDetails` su ogni risposta di errore):
   *
   * - **403** "Operazione non consentita" → credenziale non valida o
   *   operazione vietata: MAI ritentare (martellare l'ente con una
   *   credenziale che non funzionerà mai non ha senso). Solleva subito
   *   {@link RentriApiError} con `retryable: false`.
   * - **429** → rispetta `Retry-After` se presente, altrimenti backoff
   *   esponenziale.
   * - **423** (risorsa bloccata) e **5xx** → backoff esponenziale.
   * - Esauriti i tentativi per un codice transitorio → solleva
   *   {@link RentriApiError} con `retryable: true` (fallimento dopo aver
   *   provato: il chiamante può ancora decidere un retry a un livello più
   *   alto, es. un nuovo job in coda).
   * - Qualunque altro codice non atteso in questo punto del ciclo → errore
   *   generico invariato rispetto al comportamento preesistente.
   *
   * Usata sia dal ramo "risposta con status arbitrario" (polling, dove
   * `validateStatus` impedisce ad axios di sollevare un'eccezione), sia —
   * tramite {@link eseguiRichiestaConResilienza} — dal ramo "eccezione axios".
   */
  private async gestisciRispostaNonPrevista(
    risposta: { status: number; headers?: Record<string, unknown>; data?: unknown },
    contesto: string,
    tentativo: number
  ): Promise<'ritenta'> {
    const { status } = risposta
    const problema = this.estraiProblemDetails(risposta.data)

    if (status === 403) {
      this.logger.warn(
        `RENTRI ha rifiutato la richiesta a ${contesto} (403): credenziale non valida o operazione non consentita, nessun nuovo tentativo`,
        { title: problema.title, detail: problema.detail }
      )
      this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'FORBIDDEN' })
      throw new RentriApiError(403, problema.title, problema.detail, false)
    }

    const ritentabile = status === 429 || status === 423 || status >= 500

    if (!ritentabile) {
      throw new Error(`Risposta inattesa da ${contesto}: HTTP ${status}`)
    }

    if (tentativo >= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA) {
      this.logger.error(
        `RENTRI continua a rispondere ${status} a ${contesto}: esauriti i ${RENTRIApiClient.MAX_TENTATIVI_RESILIENZA} tentativi`,
        undefined,
        { title: problema.title, detail: problema.detail }
      )
      this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
      throw new RentriApiError(status, problema.title, problema.detail, true)
    }

    const retryAfter = risposta.headers?.['retry-after'] ?? risposta.headers?.['Retry-After']
    const attesaMs = this.calcolaAttesaMs(tentativo, retryAfter as string | undefined)

    this.logger.warn(
      `RENTRI ha risposto ${status} a ${contesto}: nuovo tentativo (${tentativo}/${RENTRIApiClient.MAX_TENTATIVI_RESILIENZA}) dopo ${attesaMs}ms`,
      { title: problema.title, detail: problema.detail }
    )
    this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
    await this.attendi(attesaMs)
    return 'ritenta'
  }

  /**
   * Esegue `azione` (una chiamata `post()`/`get()` che solleva un'eccezione
   * axios-like su risposta non-2xx) applicando la stessa politica di
   * {@link gestisciRispostaNonPrevista} al ramo di eccezione. `azione` viene
   * rieseguita per intero a ogni tentativo, quindi ogni ritentativo costruisce
   * una nuova autenticazione (nuovo JWT self-issued/`jti`, nuova firma di
   * integrità) invece di riusare quella del tentativo precedente.
   */
  private async eseguiRichiestaConResilienza(
    azione: () => Promise<AxiosResponse>,
    contesto: string
  ): Promise<AxiosResponse> {
    for (let tentativo = 1; tentativo <= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      try {
        return await azione()
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') {
          // Nessuna risposta HTTP riconoscibile (es. timeout, errore di rete):
          // comportamento preesistente, invariato.
          throw error
        }

        await this.gestisciRispostaNonPrevista(risposta, contesto, tentativo)
        // 'ritenta': si riprova il ciclo (l'attesa è già stata eseguita sopra).
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
  }

  /**
   * POST con autenticazione adeguata alla modalità (mock: X-API-Key;
   * live: Bearer + firma di integrità Agid-JWT-Signature sul body).
   *
   * `tenantId`, se indicato, individua l'operatore per cui firmare il JWT
   * self-issued; in assenza si ricade sul tenant del contesto corrente
   * ({@link tenantIdCorrente}).
   */
  private async post(path: string, body: unknown, metricEndpoint: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`
    const rawBody = JSON.stringify(body)

    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.isLive) {
      const authorization = await this.auth.creaAuthorizationHeader(
        tenantId ?? this.tenantIdCorrente()
      )
      const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody)
      headers = {
        ...headers,
        Authorization: authorization,
        ...integrityHeaders,
      }
    } else {
      headers['X-API-Key'] = this.config.mockApiKey
    }

    try {
      return await firstValueFrom(
        this.httpService.post(url, body, { headers, timeout: this.timeout })
      )
    } catch (error: any) {
      this.metrics.rentriApiErrors.inc({ endpoint: metricEndpoint, error_type: 'HTTP' })
      throw error
    }
  }

  /** GET con Bearer (live) o X-API-Key (mock). V. {@link post} per `tenantId`. */
  private async get(path: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`
    const headers = await this.buildAuthHeaders(tenantId)

    return firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
  }

  /**
   * Header di autenticazione adeguati alla modalità: Bearer self-issued
   * (live) o `X-API-Key` (mock). Condiviso da {@link get} e dai metodi di
   * polling del ciclo NONBLOCK_PULL ({@link interrogaStatoTransazione},
   * {@link leggiEsitoTransazione}).
   */
  private async buildAuthHeaders(tenantId?: string): Promise<Record<string, string>> {
    if (this.isLive) {
      return {
        Authorization: await this.auth.creaAuthorizationHeader(tenantId ?? this.tenantIdCorrente()),
      }
    }
    return { 'X-API-Key': this.config.mockApiKey }
  }

  /**
   * Tenant per cui firmare il JWT self-issued: quello del contesto della
   * richiesta corrente, oppure stringa vuota (fa scattare il fallback da env
   * dentro {@link RentriAuthService} per il pilota single-operator).
   */
  private tenantIdCorrente(): string {
    return TenantContext.getTenantId() ?? ''
  }

  /**
   * Converte il FIR interno nel formato xFIR (standard RENTRI — D.M. 59/2023).
   *
   * Supporta DUE strutture di input in modo trasparente:
   *
   * 1. **Aggregate FIR** (`aggregates/fir.aggregate.ts`) — restituito dal
   *    repository Prisma. Le anagrafiche sono snapshot annidati (`ParteFIR`):
   *    `fir.produttore.partitaIva`, `fir.rifiuto.cerCode`,
   *    `fir.rifiuto.quantita.valore` (value object `Quantita`), ecc.
   *
   * 2. **Flat DTO** (usato nei test unitari, shape legacy): proprietà piatte
   *    `fir.producerPartitaIva`, `fir.cerCode`, `fir.quantity`, ecc.
   *
   * La risoluzione usa `??` (nullish coalescing): la forma aggregate ha
   * precedenza, il flat DTO serve da fallback per retrocompatibilità.
   *
   * I nomi dei campi nel payload xFIR sono in italiano, coerenti con le
   * specifiche tecniche RENTRI (D.M. 59/2023).
   *
   * NON ANCORA ALLINEATO al contratto: la mappatura verso `NuovoFormularioModel`
   * di `docs/contracts/rentri/formulari.yaml` e' fuori dall'ambito di P2 task 2,
   * ed e' comunque una delle attivita' che l'oracolo NON puo' validare (la fake
   * accetta qualunque corpo: vedi le riserve in docs/contracts/rentri/FEDELTA.md).
   * Va verificata contro l'ambiente demo reale.
   */
  private convertToXFIRFormat(fir: any): XFIRPayload {
    // Snapshot anagrafici (FIR aggregate) — null se non popolati.
    const snapshotProduttore = fir.produttore ?? null
    const snapshotTrasportatore = fir.trasportatore ?? null
    const snapshotDestinatario = fir.destinatario ?? null
    // Waste info (FIR aggregate ha `rifiuto: FIRRifiuto` con `quantita: Quantita`).
    const rifiutoAgg = fir.rifiuto ?? null
    // Value object Quantita: { valore: number, unitaMisura: string }
    const quantitaVo = rifiutoAgg?.quantita ?? null

    return {
      firId: fir.id,
      // FIR aggregate: `numeroProgressivo` (assegnato all'emissione); flat DTO: `firNumber`
      numeroFormulario: fir.numeroProgressivo ?? fir.firNumber,
      dataEmissione: new Date().toISOString(),

      // Produttore — snapshot ParteFIR (aggregate) con fallback flat DTO
      produttore: {
        partitaIva: snapshotProduttore?.partitaIva ?? fir.producerPartitaIva,
        ragioneSociale: snapshotProduttore?.ragioneSociale ?? fir.producerName,
        indirizzo: snapshotProduttore?.indirizzo ?? fir.producerAddress,
        contatto: snapshotProduttore?.contatto ?? fir.producerContact,
      },

      // Trasportatore — snapshot ParteFIR (aggregate) con fallback flat DTO
      trasportatore: {
        partitaIva: snapshotTrasportatore?.partitaIva ?? fir.carrierPartitaIva,
        ragioneSociale: snapshotTrasportatore?.ragioneSociale ?? fir.carrierName,
        // `targaVeicolo` è nel snapshot trasportatore o nei dati di trasporto
        targaVeicolo: snapshotTrasportatore?.targaVeicolo ?? fir.carrierVehiclePlate,
        contatto: snapshotTrasportatore?.contatto ?? fir.carrierContact,
      },

      // Destinatario — snapshot ParteFIR (aggregate) con fallback flat DTO
      destinatario: {
        partitaIva: snapshotDestinatario?.partitaIva ?? fir.receiverPartitaIva,
        ragioneSociale: snapshotDestinatario?.ragioneSociale ?? fir.receiverName,
        indirizzo: snapshotDestinatario?.indirizzo ?? fir.receiverAddress,
        contatto: snapshotDestinatario?.contatto ?? fir.receiverContact,
      },

      // Rifiuto — FIRRifiuto (aggregate) con fallback flat DTO
      rifiuto: {
        codiceEER: rifiutoAgg?.cerCode ?? fir.cerCode,
        descrizione: rifiutoAgg?.descrizione ?? fir.wasteDescription,
        categoria: rifiutoAgg?.categoria ?? fir.wasteCategory,
        // Quantita value object ha `.valore` (numero) e `.unitaMisura` (enum)
        quantita: quantitaVo?.valore ?? fir.quantity,
        unita: quantitaVo?.unitaMisura ?? fir.unit,
        // Campi aggiuntivi DM 59/2023 (presenti solo nell'aggregate)
        statoFisico: rifiutoAgg?.statoFisico,
        caratteristichePericolo: rifiutoAgg?.caratteristichePericolo,
        numeroColli: rifiutoAgg?.numeroColli,
        codiceOperazione: rifiutoAgg?.codiceOperazione,
      },

      // Trasporto — date dell'aggregate (dataPresaCarico/dataConsegna) o flat DTO
      trasporto: {
        // dataPresaCarico = data partenza (aggregato); transportDate = flat DTO
        dataPartenza:
          (fir.dataPresaCarico ?? fir.transportDate)?.toISOString?.() ??
          fir.dataPresaCarico ??
          fir.transportDate,
        dataArrivoPrevista: fir.estimatedArrivalDate?.toISOString?.() ?? fir.estimatedArrivalDate,
        // dataConsegna = data arrivo effettiva (aggregato); undefined se non ancora consegnato
        dataArrivo: fir.dataConsegna?.toISOString?.(),
        // Campo 17 FIR (annotazioni) o transportNotes del flat DTO
        note: fir.annotazioni ?? fir.transportNotes,
      },

      // Firme digitali — FirmeDigitali (aggregate) o array piatto (flat DTO)
      firmeDigitali: this.buildFirmeDigitali(fir),
    }
  }

  /**
   * Costruisce l'array `firmeDigitali` per xFIR supportando entrambe le forme:
   * - **Aggregate**: `fir.firme: { produttore?, trasportatore?, destinatario? }`
   *   dove ciascuna è una `FirmaDigitale { firmatario, timestamp, certificato }`.
   * - **Flat DTO**: `fir.signatures: any[]` (array con shape legacy).
   */
  private buildFirmeDigitali(fir: any): any[] {
    // FIR aggregate: `fir.firme` è sempre un oggetto (anche vuoto `{}`)
    if (fir.firme && typeof fir.firme === 'object') {
      const firme = fir.firme as { produttore?: any; trasportatore?: any; destinatario?: any }
      const result: any[] = []
      const roles: Array<['PRODUTTORE' | 'TRASPORTATORE' | 'DESTINATARIO', any]> = [
        ['PRODUTTORE', firme.produttore],
        ['TRASPORTATORE', firme.trasportatore],
        ['DESTINATARIO', firme.destinatario],
      ]
      for (const [ruolo, fd] of roles) {
        if (!fd) continue
        result.push({
          ruolo,
          dataFirma: fd.timestamp?.toISOString?.() ?? fd.timestamp,
          firmatario: fd.firmatario,
          hashCertificato: fd.certificato,
        })
      }
      return result
    }
    // Flat DTO legacy (test)
    return this.convertSignatures(fir.signatures || [])
  }

  /**
   * Converte un array di firme flat DTO in formato xFIR (retrocompatibilità test).
   */
  private convertSignatures(signatures: any[]): any[] {
    return signatures.map(sig => ({
      ruolo: sig.role,
      dataFirma: sig.signedAt?.toISOString?.() ?? sig.signedAt,
      metodo: sig.signatureMethod,
      valoreSignatura: sig.signatureValue,
      hashCertificato: sig.certificateHash,
      hashDocumento: sig.documentHash,
      timestampToken: sig.timestampToken,
    }))
  }
}

/**
 * Errore che rappresenta una risposta di errore RENTRI (`ProblemDetails`,
 * `application/problem+json`) dopo l'eventuale esaurimento dei tentativi di
 * resilienza (v. {@link RENTRIApiClient.eseguiRichiestaConResilienza} /
 * {@link RENTRIApiClient['gestisciRispostaNonPrevista']}).
 *
 * `retryable` distingue:
 * - `false` — **403**, fallimento definitivo: credenziale non valida o
 *   operazione non consentita. Ritentare non avrebbe senso (la credenziale
 *   non funzionerà al tentativo successivo), quindi il client non lo fa MAI.
 * - `true` — **429/423/5xx**, fallimento dopo aver esaurito i tentativi di
 *   resilienza del client stesso. Resta un errore transitorio: chi chiama
 *   può ancora decidere un nuovo tentativo a un livello più alto (es. un
 *   nuovo job in coda).
 *
 * `problemTitle`/`problemDetail` sono gli UNICI campi del corpo di errore
 * riportati nei log/nel log di sincronizzazione: il corpo grezzo della
 * risposta RENTRI non va mai esposto al tenant.
 */
export class RentriApiError extends Error {
  constructor(
    readonly status: number,
    readonly problemTitle: string | undefined,
    readonly problemDetail: string | undefined,
    readonly retryable: boolean
  ) {
    super(
      retryable
        ? `RENTRI ha risposto ${status} (${problemTitle ?? 'errore transitorio'}): tentativi di resilienza esauriti`
        : `RENTRI ha rifiutato la richiesta (${status}): ${problemTitle ?? 'operazione non consentita'}`
    )
    this.name = 'RentriApiError'
  }
}

/**
 * Payload xFIR "flat" usato SOLO dal flusso legacy `mock` (`submitFIR`,
 * `validateFIR` verso `tools/rentri-mock`). Non è un modello del contratto
 * ufficiale RENTRI: la creazione reale di un FIR usa `NuovoFormularioPayload`
 * (contratto) tramite {@link RENTRIApiClient.creaFormulario}.
 */
export interface XFIRPayload {
  firId: string
  /** Numero formulario (FIR-ANNO-NNNNNN). */
  numeroFormulario: string | null
  /** Data e ora di emissione del documento (ISO 8601). */
  dataEmissione: string
  produttore: {
    partitaIva?: string
    ragioneSociale?: string
    indirizzo?: string
    contatto?: string
  }
  trasportatore: {
    partitaIva?: string
    ragioneSociale?: string
    targaVeicolo?: string
    contatto?: string
  }
  destinatario: {
    partitaIva?: string
    ragioneSociale?: string
    indirizzo?: string
    contatto?: string
  }
  rifiuto: {
    codiceEER?: string
    descrizione?: string
    categoria?: string
    quantita?: number
    unita?: string
    statoFisico?: string
    caratteristichePericolo?: string
    numeroColli?: number
    codiceOperazione?: string
  }
  trasporto: {
    dataPartenza?: string
    dataArrivoPrevista?: string
    /** Data arrivo effettiva — valorizzata dopo la consegna. */
    dataArrivo?: string
    note?: string
  }
  firmeDigitali: any[]
}

/**
 * Opzioni configurabili del polling NONBLOCK_PULL di {@link RENTRIApiClient.attendiEsito}.
 */
export interface OpzioniPollingEsito {
  /** Intervallo (ms) tra un tentativo e l'altro. Default 2000. */
  intervalloMs?: number
  /**
   * Numero massimo di tentativi prima di sollevare un errore esplicito.
   * Default 30. Un limite è obbligatorio: senza, un worker della coda
   * resterebbe bloccato in un polling potenzialmente infinito.
   */
  maxTentativi?: number
}

/**
 * Esito di una transazione completata (`EsitoFormularioModel`, contratto
 * ufficiale, formulari.yaml righe 9378-9414). Sono garantiti sempre
 * presenti `errore` e `validazione`; gli altri campi del modello
 * (`transazione_id`, `tipo`, `esito`, `tempo_elaborazione`) arrivano così
 * come restituiti da `/result`.
 */
export interface EsitoFormulario {
  errore: boolean
  validazione: unknown[]
  [key: string]: unknown
}

/**
 * Corpo della richiesta `POST /` (`NuovoFormularioModel`, contratto
 * ufficiale, formulari.yaml righe 9907+). La mappatura completa dei campi
 * xFIR → `NuovoFormularioModel` non è oggetto di questo task (allineamento
 * dei path/verbi): il payload viaggia così com'è passato dal chiamante.
 */
export type NuovoFormularioPayload = Record<string, unknown>

/**
 * Corpo della risposta 200 di `GET /{numero_fir}` (`DettaglioFormulario`,
 * contratto ufficiale, formulari.yaml righe 9032-9139). I campi di primo
 * livello sono elencati per nome dal contratto; gli oggetti/array annidati
 * (dati di partenza, trasporto, accettazione, ecc.) non sono modellati in
 * dettaglio qui — non serve a questo task, che riguarda solo l'allineamento
 * del path/verbo di lettura.
 */
export interface FormularioModel {
  stato_formulario?: string
  versione?: number | null
  data_creazione?: string | null
  provenienza_upload?: boolean | null
  trasformato_in_cartaceo?: boolean | null
  num_iscr_sito?: string | null
  dati_vidimazione?: unknown
  dati_partenza?: unknown
  dati_trasporto?: unknown[] | null
  dati_accettazione?: unknown
  dati_annotazioni?: unknown[] | null
  dati_allegati?: unknown[] | null
  dati_annullamento?: unknown
  dati_trasbordo_totale?: unknown
  dati_trasbordi_parziali?: unknown[] | null
  dati_soste_tecniche?: unknown[] | null
  dati_destinazioni_successive?: unknown[] | null
}

/**
 * RENTRI API Response Types
 */
export interface RENTRISubmitResponse {
  success: boolean
  protocolNumber?: string
  rentriId?: string
  receivedAt?: string
  errors?: Array<{ code: string; field: string; message: string }>
}

export interface RENTRIValidationResponse {
  valid: boolean
  errors: Array<{ code: string; field: string; message: string }>
  warnings: string[]
}

export interface RENTRIFIRStatus {
  firId: string
  rentriId: string
  protocolNumber: string
  status: 'ACCEPTED' | 'REJECTED' | 'PROCESSING'
  submittedAt: string
}
