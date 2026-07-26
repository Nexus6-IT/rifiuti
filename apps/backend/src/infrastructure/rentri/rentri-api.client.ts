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
 * Comunica con l'ambiente reale RENTRI (demo/prod, vedi {@link RentriConfig})
 * con autenticazione ID_AUTH_REST_02 del Modello di Interoperabilità AgID:
 * JWT self-issued Bearer, firmato ad ogni chiamata (vedi {@link RentriAuthService}),
 * e firma di integrità `Agid-JWT-Signature` su ogni richiesta con body (vedi
 * {@link RentriSignatureService}).
 *
 * I metodi allineati al contratto ufficiale (`creaFormulario`, `leggiFormulario`,
 * `attendiEsito`) parlano i modelli del contratto (`NuovoFormularioModel`,
 * `DettaglioFormulario`, `EsitoFormularioModel`).
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
   * POST con autenticazione ID_AUTH_REST_02: Bearer self-issued + firma di
   * integrità Agid-JWT-Signature sul body.
   *
   * `tenantId`, se indicato, individua l'operatore per cui firmare il JWT
   * self-issued; in assenza si ricade sul tenant del contesto corrente
   * ({@link tenantIdCorrente}).
   */
  private async post(path: string, body: unknown, metricEndpoint: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`
    const rawBody = JSON.stringify(body)

    const authorization = await this.auth.creaAuthorizationHeader(
      tenantId ?? this.tenantIdCorrente()
    )
    const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody)
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
      this.metrics.rentriApiErrors.inc({ endpoint: metricEndpoint, error_type: 'HTTP' })
      throw error
    }
  }

  /** GET con Bearer self-issued. V. {@link post} per `tenantId`. */
  private async get(path: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`
    const headers = await this.buildAuthHeaders(tenantId)

    return firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }))
  }

  /**
   * Header di autenticazione Bearer self-issued. Condiviso da {@link get} e
   * dai metodi di polling del ciclo NONBLOCK_PULL
   * ({@link interrogaStatoTransazione}, {@link leggiEsitoTransazione}).
   */
  private async buildAuthHeaders(tenantId?: string): Promise<Record<string, string>> {
    return {
      Authorization: await this.auth.creaAuthorizationHeader(tenantId ?? this.tenantIdCorrente()),
    }
  }

  /**
   * Tenant per cui firmare il JWT self-issued: quello del contesto della
   * richiesta corrente, oppure stringa vuota (fa scattare il fallback da env
   * dentro {@link RentriAuthService} per il pilota single-operator).
   */
  private tenantIdCorrente(): string {
    return TenantContext.getTenantId() ?? ''
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
 * Esito di creazione di un nuovo FIR (`EsitoNuovoFormularioModel`, contratto
 * ufficiale, formulari.yaml righe 9503-9512). È una delle nove varianti del
 * `oneOf` di `EsitoFormularioModel.esito` (formulari.yaml righe 9381-9392,
 * `EsitoCommonModel | EsitoNuovoFormularioModel | EsitoGetHashPerFirmaModel |
 * EsitoAddAllegatoModel | EsitoValidaXfirModel | EsitoUploadXfirModel |
 * EsitoCaricaCopiaCartaceaModel | EsitoCaricaCopiaDigitaleModel |
 * EsitoEstraiDatiXfirModel`): il numero ufficiale RENTRI esiste SOLO in
 * questa variante (l'esito di una creazione), non al primo livello di
 * `EsitoFormularioModel` e non nelle altre otto varianti.
 */
export interface EsitoNuovoFormularioModel {
  numero_fir?: string | null
}

/**
 * Esito di una transazione completata (`EsitoFormularioModel`, contratto
 * ufficiale, formulari.yaml righe 9378-9414). Sono garantiti sempre
 * presenti `errore` e `validazione`; gli altri campi del modello
 * (`transazione_id`, `tipo`, `tempo_elaborazione`) arrivano così come
 * restituiti da `/result`.
 *
 * `esito` è il campo polimorfo (`oneOf`) del contratto: per la creazione di
 * un formulario risolve in {@link EsitoNuovoFormularioModel} (che porta
 * `numero_fir`); per le altre operazioni assume una forma diversa, non
 * modellata qui perché non serve a questo client. Non va MAI assunto che
 * `numero_fir` sia presente — usare {@link estraiNumeroFirDaEsito}, che
 * verifica esplicitamente la forma prima di leggerlo.
 */
export interface EsitoFormulario {
  errore: boolean
  validazione: unknown[]
  esito?: EsitoNuovoFormularioModel | Record<string, unknown> | null
  [key: string]: unknown
}

/**
 * Estrae il numero ufficiale RENTRI (`numero_fir`) da un esito di
 * transazione, se e solo se l'esito è quello di una creazione di formulario
 * e il campo è valorizzato con una stringa non vuota. Restituisce
 * `undefined` in ogni altro caso (altra variante del `oneOf`, `esito`
 * assente, `numero_fir` assente/vuoto): il chiamante non deve MAI sostituire
 * un numero mancante con un altro identificativo (es. `transazione_id`, che
 * è tecnico e non il numero ufficiale — v. Task 3-bis, R0).
 *
 * **Limite dichiarato**: la fake RENTRI usata per i test contro l'oracolo
 * accetta qualunque corpo di controllo (riserva nota in
 * `docs/contracts/rentri/FEDELTA.md`) — questa funzione dimostra che il
 * client legge correttamente `numero_fir` quando è presente nella forma
 * prevista dal contratto, non che l'ente lo restituisca davvero in quella
 * forma.
 */
export function estraiNumeroFirDaEsito(esito: EsitoFormulario): string | undefined {
  const payload = esito.esito
  if (!payload || typeof payload !== 'object' || !('numero_fir' in payload)) {
    return undefined
  }
  const numeroFir = (payload as EsitoNuovoFormularioModel).numero_fir
  return typeof numeroFir === 'string' && numeroFir.trim() !== '' ? numeroFir : undefined
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
