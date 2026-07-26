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
import { gestisciRispostaErroreRentri, attendiMs } from './rentri-http-resilienza'

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

  /** Valore di default dell'header `Paging-Page` (formulari.yaml righe 112-120). */
  private static readonly PAGING_PAGE_DEFAULT = 1

  /** Valore di default dell'header `Paging-PageSize` (formulari.yaml righe 121-129). */
  private static readonly PAGING_PAGE_SIZE_DEFAULT = 100

  /**
   * Cerca i formulari (`GET /` — formulari.yaml righe 15-172, "Elenco
   * formulari"). Uno tra `identificativoSoggetto` (il codice fiscale di un
   * soggetto coinvolto, indipendentemente da chi ha creato il FIR) e
   * `numIscrSito` (l'unità locale per cui è già stata acquisita la
   * visibilità) DEVE essere valorizzato — il contratto li dichiara
   * mutuamente esclusivi (righe 29 e 45: ciascuno "deve essere valorizzato
   * in assenza" dell'altro). Passare zero o due filtri è un errore di
   * programmazione del chiamante: viene rifiutato qui, PRIMA di contattare
   * RENTRI, per non trasformarlo in un 400 rumoroso dell'ente.
   *
   * La paginazione dichiarata dal contratto (`Paging-Page`/`Paging-PageSize`
   * in richiesta, righe 112-129; `Paging-PageCount`/`Paging-TotalRecordCount`
   * in risposta, righe 137-157) è gestita esplicitamente: senza, un tenant
   * con centinaia di formulari vedrebbe solo i primi 100 (default RENTRI) e
   * nessun modo di sapere che ce ne sono altri.
   *
   * Ogni elemento della risposta porta `visibilita_sito_acquisita`
   * (`FormularioItemResult`, formulari.yaml riga 9794): è il modo corretto
   * di sapere se un formulario trovato va ancora agganciato, non un secondo
   * giro di ricerca.
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza}.
   */
  async cercaFormulari(
    tenantId: string,
    filtri: FiltriRicercaFormulari
  ): Promise<RisultatoRicercaFormulari> {
    const haIdentificativoSoggetto = Boolean(filtri.identificativoSoggetto)
    const haNumIscrSito = Boolean(filtri.numIscrSito)

    if (haIdentificativoSoggetto === haNumIscrSito) {
      throw new Error(
        "cercaFormulari richiede esattamente uno tra 'identificativoSoggetto' e 'numIscrSito' " +
          '(formulari.yaml righe 29 e 45: mutuamente esclusivi, mai nessuno dei due, mai entrambi).'
      )
    }

    const query = new URLSearchParams()
    if (filtri.identificativoSoggetto) {
      query.set('identificativo_soggetto', filtri.identificativoSoggetto)
    }
    if (filtri.numIscrSito) {
      query.set('num_iscr_sito', filtri.numIscrSito)
    }

    const page = filtri.paging?.page ?? RENTRIApiClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri.paging?.pageSize ?? RENTRIApiClient.PAGING_PAGE_SIZE_DEFAULT

    const response = await this.eseguiRichiestaConResilienza(
      () =>
        this.get(`${RENTRIApiClient.FORMULARI_PATH}/?${query.toString()}`, tenantId, {
          'Paging-Page': String(page),
          'Paging-PageSize': String(pageSize),
        }),
      '/formulari (ricerca)'
    )

    const headers = response.headers ?? {}
    const leggiHeaderNumerico = (nome: string, fallback: number): number => {
      const valore = headers[nome.toLowerCase()] ?? headers[nome]
      const numero = Number(valore)
      return Number.isFinite(numero) ? numero : fallback
    }

    return {
      risultati: Array.isArray(response.data) ? (response.data as FormularioItemResult[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /**
   * Acquisisce la visibilità in ricerca di un FIR digitale creato da terzi
   * su una propria unità locale (`POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}`
   * — formulari.yaml riga 657, **non** `/acquisizione/{num_iscr_sito}`,
   * deprecato — righe 716-745).
   *
   * **Sincrona, non NONBLOCK_PULL**: a differenza di `creaFormulario`
   * (esplicitamente etichettata "🔁[ASYNC]" dal contratto, risposta SEMPRE
   * 202 + polling), questa operazione dichiara come unico esito positivo
   * `200` immediato ("L'acquisizione di visibilità è avvenuta con
   * successo") — nessun `202`, nessun `TransazioneModel`, nessuna voce
   * `[ASYNC]` nel `summary`. Non c'è quindi alcuna transazione da attendere
   * con {@link attendiEsito}: il verificarlo contro il contratto (non
   * assumerlo) era esplicitamente richiesto dal piano di questo task.
   *
   * Nessun corpo richiesto dal contratto: si invia un corpo vuoto solo
   * perché {@link post} calcola sempre la firma di integrità su una stringa
   * (un body `undefined` romperebbe il calcolo del digest).
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza}
   * (403 qui ha un significato di dominio specifico: l'utenza non ha
   * incarichi su alcun soggetto coinvolto nel FIR, o l'unità locale indicata
   * non le è riferibile — v. `rentri-error-presentation.ts`, Task 7).
   */
  async acquisisciVisibilita(
    tenantId: string,
    numeroFir: string,
    numIscrSito: string,
    correlationId?: string
  ): Promise<void> {
    this.logger.debug('Acquisizione visibilità FIR avviata', {
      numeroFir,
      numIscrSito,
      correlationId,
    })

    await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/acquisizione-visibilita/${numIscrSito}`,
          {},
          '/formulari (acquisizione-visibilita)',
          tenantId
        ),
      '/formulari (acquisizione-visibilita)'
    )
  }

  /**
   * Rilascia la visibilità in ricerca precedentemente acquisita su un FIR
   * digitale creato da terzi (`POST /{numero_fir}/rilascio-visibilita/{num_iscr_sito}`
   * — formulari.yaml riga 2030, **non** `/respingi`, deprecato). Operazione
   * inversa di {@link acquisisciVisibilita}: "abbandona" la visibilità senza
   * cancellare il formulario dall'ente.
   *
   * **Sincrona**, stessa verifica di {@link acquisisciVisibilita}: il
   * contratto dichiara solo `200` immediato, nessun `202`/NONBLOCK_PULL.
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza}.
   */
  async rilasciaVisibilita(
    tenantId: string,
    numeroFir: string,
    numIscrSito: string,
    correlationId?: string
  ): Promise<void> {
    this.logger.debug('Rilascio visibilità FIR avviato', {
      numeroFir,
      numIscrSito,
      correlationId,
    })

    await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/rilascio-visibilita/${numIscrSito}`,
          {},
          '/formulari (rilascio-visibilita)',
          tenantId
        ),
      '/formulari (rilascio-visibilita)'
    )
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
    return attendiMs(ms)
  }

  /** Numero massimo di tentativi per gli errori transitori (429/423/5xx). */
  private static readonly MAX_TENTATIVI_RESILIENZA = 5

  /** Base (ms) del backoff esponenziale quando l'ente non indica `Retry-After`. */
  private static readonly BACKOFF_BASE_MS = 1000

  /** Tetto (ms) del backoff esponenziale, per non attendere indefinitamente. */
  private static readonly BACKOFF_MAX_MS = 30000

  /**
   * Classifica una risposta di errore RENTRI e, se transitoria, attende
   * prima del prossimo tentativo. Delegata a {@link gestisciRispostaErroreRentri}
   * (`rentri-http-resilienza.ts`), condivisa con il client delle codifiche:
   * stessa politica (403 mai ritentato, 429/423/5xx con backoff/`Retry-After`),
   * un solo posto dove è scritta.
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
    return gestisciRispostaErroreRentri(
      risposta,
      contesto,
      tentativo,
      RENTRIApiClient.MAX_TENTATIVI_RESILIENZA,
      this.logger,
      this.metrics,
      ms => this.attendi(ms),
      { baseMs: RENTRIApiClient.BACKOFF_BASE_MS, maxMs: RENTRIApiClient.BACKOFF_MAX_MS }
    )
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

  /**
   * GET con Bearer self-issued. V. {@link post} per `tenantId`.
   * `extraHeaders` (es. `Paging-Page`/`Paging-PageSize` di {@link cercaFormulari})
   * si aggiunge all'header di autenticazione, senza sostituirlo.
   */
  private async get(path: string, tenantId?: string, extraHeaders?: Record<string, string>) {
    const url = `${this.config.baseUrl}${path}`
    const headers = { ...(await this.buildAuthHeaders(tenantId)), ...extraHeaders }

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
 * `RentriApiError` è ora definita in `rentri-http-resilienza.ts` (condivisa
 * col client delle codifiche): ri-esportata qui per non rompere gli import
 * esistenti (`import { RentriApiError } from './rentri-api.client'`).
 */
export { RentriApiError } from './rentri-http-resilienza'

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
 * `IndirizzoModel` (formulari.yaml righe 9815-9842): `citta` è un `oneOf` fra
 * `ComuneModel` (comune italiano, solo `comune_id` ISTAT — RENTRI NON
 * restituisce qui il nome del comune/provincia leggibili: servirebbe una
 * chiamata separata a `GET /codifiche/v1.0/comuni`, fuori scope di questo
 * task) e `CittaEsteraModel` (`nazione_id` + `nome_citta` in chiaro).
 */
export interface IndirizzoRENTRIResult {
  citta?:
    | { comune_id?: string | null }
    | { nazione_id?: string | null; nome_citta?: string | null }
    | null
  indirizzo?: string | null
  civico?: string | null
  cap?: string | null
}

/** `DatiProduttoreFormularioResultModel` (formulari.yaml righe 7706-7772): sottoinsieme usato dalla mappatura Task 5. */
export interface DatiProduttoreFormularioResult {
  denominazione: string
  codice_fiscale: string
  indirizzo?: IndirizzoRENTRIResult | null
}

/** `DatiDestinatarioFormularioResultModel` (formulari.yaml righe 7136-7206): sottoinsieme usato dalla mappatura Task 5. */
export interface DatiDestinatarioFormularioResult {
  denominazione: string
  codice_fiscale: string
  indirizzo?: IndirizzoRENTRIResult | null
  /** Attività di recupero/smaltimento a destinazione (es. "R13", "D15") — Campo 3 FIR locale (`codiceOperazione`). */
  attivita?: string | null
}

/** `DatiTrasportatoreFormularioResultModel` (formulari.yaml righe 8482-8538): sottoinsieme usato dalla mappatura Task 5. */
export interface DatiTrasportatoreFormularioResult {
  denominazione: string
  codice_fiscale: string
  /** `TipoTrasporto` (formulari.yaml righe 10267-10272): Terrestre | Ferroviario | Marittimo. */
  tipo_trasporto?: string | null
  numero_iscrizione_albo?: string | null
}

/** `QuantitaModel\`1` (formulari.yaml righe 10089-10107): unità ammesse "kg" | "l". */
export interface QuantitaRENTRIResult {
  valore: number
  unita_misura: string
}

/** `DatiRifiutoModel` (formulari.yaml righe 7892-7971): sottoinsieme usato dalla mappatura Task 5. */
export interface DatiRifiutoResult {
  codice_eer: string
  descrizione?: string | null
  stato_fisico?: string | null
  /** `CaratteristichePericolo` (formulari.yaml righe 6167-6184): es. ["HP07", "HP14"]. */
  caratteristiche_pericolo?: string[] | null
  /** Nonostante il nome, il contratto lo tipizza `string` (non intero). */
  numero_colli?: string | null
  quantita?: QuantitaRENTRIResult | null
}

/**
 * `DatiPartenzaResultModel` (formulari.yaml righe 7553-7613): sottoinsieme
 * usato dalla mappatura Task 5 (produttore/destinatario/trasportatori/rifiuto
 * necessari a costruire il FIR locale, v. `crea-fir-da-dettaglio-rentri.use-case.ts`).
 */
export interface DatiPartenzaResult {
  produttore?: DatiProduttoreFormularioResult | null
  destinatario?: DatiDestinatarioFormularioResult | null
  trasportatori?: DatiTrasportatoreFormularioResult[] | null
  rifiuto?: DatiRifiutoResult | null
  /** Campo 17 FIR (DM 59/2023): annotazioni libere — corrisponde 1:1 a `FIR.annotazioni`. */
  annotazioni?: string | null
}

/**
 * Corpo della risposta 200 di `GET /{numero_fir}` (`DettaglioFormulario`,
 * contratto ufficiale, formulari.yaml righe 9032-9139). I campi di primo
 * livello sono elencati per nome dal contratto; `dati_partenza` è tipizzato
 * in dettaglio (necessario alla mappatura Task 5, v.
 * `crea-fir-da-dettaglio-rentri.use-case.ts`); gli altri oggetti/array
 * annidati (trasporto, accettazione, allegati, trasbordi, soste tecniche,
 * destinazioni successive, ecc.) restano `unknown` — nessun campo locale
 * corrispondente in questo giro (nessuna migrazione Prisma consentita), v.
 * commento di classe del use case Task 5 per la scelta esplicita di non
 * perderli silenziosamente ma di documentarli come lacuna nota.
 */
export interface FormularioModel {
  stato_formulario?: string
  versione?: number | null
  data_creazione?: string | null
  provenienza_upload?: boolean | null
  trasformato_in_cartaceo?: boolean | null
  num_iscr_sito?: string | null
  dati_vidimazione?: unknown
  dati_partenza?: DatiPartenzaResult | null
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
 * Filtri di {@link RENTRIApiClient.cercaFormulari} (`GET /`, formulari.yaml
 * righe 15-172). `identificativoSoggetto` e `numIscrSito` sono mutuamente
 * esclusivi: esattamente uno dei due deve essere valorizzato (righe 29 e
 * 45) — il client lo verifica prima di contattare RENTRI.
 */
export interface FiltriRicercaFormulari {
  /** Codice fiscale di un soggetto coinvolto nel FIR, indipendentemente dal ruolo o da chi l'ha creato. */
  identificativoSoggetto?: string
  /** Numero di iscrizione dell'unità locale per cui è stata acquisita la visibilità. */
  numIscrSito?: string
  /** Paginazione (`Paging-Page`/`Paging-PageSize`): default page=1, pageSize=100, max pageSize=1000 (righe 112-129). */
  paging?: {
    page?: number
    pageSize?: number
  }
}

/**
 * Elemento della lista restituita da `GET /` (`FormularioItemResult`,
 * formulari.yaml righe 9686-9800). Solo i campi di primo livello utili alla
 * ricerca/aggancio sono modellati qui: gli oggetti anagrafici annidati
 * (produttore, destinatari, trasportatori, ecc.) non servono a questo task.
 */
export interface FormularioItemResult {
  numero_fir?: string | null
  data_emissione?: string | null
  num_iscr_sito?: string | null
  identificativo_soggetto?: string | null
  data_creazione?: string | null
  codice_eer?: string | null
  quantita?: number | null
  unita_misura?: string | null
  stato_fisico?: string | null
  caratteristiche_pericolo?: string | null
  descrizione_rifiuto?: string | null
  stato?: string | null
  is_upload?: boolean | null
  trasformato_in_cartaceo?: boolean | null
  versione?: number | null
  /**
   * Indica se il formulario è già stato acquisito in visibilità da almeno
   * un'unità locale diversa da quella che l'ha creato, riconducibile al
   * soggetto per cui viene fatta la richiesta (formulari.yaml riga 9794).
   * È il modo corretto di sapere se un formulario trovato va ancora
   * agganciato: non richiede una seconda chiamata.
   */
  visibilita_sito_acquisita?: boolean | null
  [key: string]: unknown
}

/** Esito paginato di {@link RENTRIApiClient.cercaFormulari}, header `Paging-*` della risposta (righe 137-157). */
export interface RisultatoRicercaFormulari {
  risultati: FormularioItemResult[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}
