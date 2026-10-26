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
import { RentriRateLimiterService } from './rentri-rate-limiter.service'
import type { StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * Errori sollevati dalla chiamata `httpService.post` stessa (richiesta
 * effettivamente inviata), per distinguerli dai fallimenti precedenti l'invio.
 */
const erroriChiamataHttp = new WeakSet<object>()

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

  /**
   * Path base del servizio `ca-rentri` v1.0 (firma remota RENTRI, R3 Task 3).
   *
   * Confermato da `docs/contracts/rentri/ca-rentri.yaml` (v. `MANIFEST.md`,
   * v1.0.20260831). Il percorso di firma e' `POST /signatures/sign-hash`
   * (ca-rentri.yaml:2019), non `/credentials/sign-hash`. **Allineati**: `GET /credentials/info`
   * (:1294; `CredentialsInfoResponse` a :2779, certificato in
   * `cert.certificates[]`), `POST /credentials/authorize` (:825) e
   * `authorize-check` (:906; schemi a :2617 e :2665). Non verificato contro
   * l'ente reale resta solo il formato della firma (la fake firma con RSA,
   * l'ente con ECDSA). Concatenato allo stesso `config.baseUrl` degli altri servizi (es.
   * `https://demoapi.rentri.gov.it/ca-rentri/v1.0`).
   */
  private static readonly CA_RENTRI_PATH = '/ca-rentri/v1.0'

  /**
   * OID dell'algoritmo di digest dichiarato dalla documentazione RENTRI per
   * `POST /credentials/authorize`: SHA-256. Costante, mai calcolata.
   */
  static readonly HASH_ALGO_SHA256 = '2.16.840.1.101.3.4.2.1'

  /**
   * OID dell'algoritmo di firma dichiarato per `POST /signatures/sign-hash`:
   * ECDSA con SHA-256. Costante, mai calcolata.
   */
  static readonly SIGN_ALGO_ECDSA_SHA256 = '1.2.840.10045.4.3.2'

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly auth: RentriAuthService,
    private readonly signature: RentriSignatureService,
    // R5 Task 2: terzo strato di resilienza (v. rentri-rate-limiter.service.ts).
    // OPZIONALE (non `@Inject` obbligatorio) per non rompere le costruzioni
    // dirette già esistenti nelle suite di test (15 file, tutte istanziano
    // RENTRIApiClient con `new` invece che via DI) — quando assente, il
    // comportamento resta quello preesistente (nessuna attesa preventiva),
    // MAI un errore. `RentriModule` lo passa sempre in produzione (risolto
    // per tipo dal container Nest, essendo un provider dello stesso modulo).
    private readonly rateLimiter?: RentriRateLimiterService
  ) {
    this.logger.setContext('RENTRIApiClient')
  }

  /**
   * Applica il limitatore preventivo per-tenant (R5 Task 1) attorno a UN
   * singolo tentativo HTTP, poi esegue `azione`. Aggancio deciso in R5 Task 2:
   * PRIMA di ogni tentativo effettivo, non attorno all'intera operazione di
   * dominio — un'operazione che consuma 5 tentativi di resilienza deve
   * consumare 5 unità del budget del limitatore, non 1, altrimenti il
   * limitatore non vedrebbe il traffico reale generato dai retry, che è
   * esattamente il traffico a rischio di superare la soglia dell'ente.
   *
   * Nessun `timeoutMs` passato ad `acquisisci()`: questo client è il punto
   * comune sia ai job automatici (BullMQ) sia alle azioni interattive, e la
   * decisione se applicare un tetto di attesa breve è del CHIAMANTE che
   * conosce il contesto (v. `RENTRI_RATE_LIMIT_TIMEOUT_AZIONE_MANUALE_MS` in
   * `rentri-rate-limiter.service.ts`) — non di questo client, che aspetterebbe
   * altrimenti la stessa cosa per un utente interattivo e per un job in coda.
   *
   * `rilascia()` è SEMPRE in `finally`: lo slot di concorrenza va liberato sia
   * che `azione()` abbia successo sia che sollevi (compreso un 429/423/5xx
   * che il chiamante ritenterà con un nuovo giro — e quindi una nuova
   * acquisizione).
   */
  private async conRateLimiter<T>(tenantId: string, azione: () => Promise<T>): Promise<T> {
    if (!this.rateLimiter) {
      return azione()
    }

    const inizio = Date.now()
    const permesso = await this.rateLimiter.acquisisci(tenantId)
    const attesaSecondi = (Date.now() - inizio) / 1000
    this.metrics.rentriRateLimiterWaitSeconds.observe({ tenant_id: tenantId }, attesaSecondi)

    try {
      return await azione()
    } finally {
      await permesso.rilascia()
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
   * Errori 403/429/423 sono gestiti da {@link eseguiRichiestaConResilienza}
   * (v. commento lì per il dettaglio della politica di retry). La POST non è
   * idempotente: su 5xx, timeout o risposta senza `transazione_id` NON si
   * ritenta e si solleva {@link TrasmissioneRentriIncertaError}.
   */
  async creaFormulario(
    tenantId: string,
    dati: NuovoFormularioPayload
  ): Promise<{ transazioneId: string; urlStato: string }> {
    const response = await this.eseguiRichiestaConResilienza(
      () => this.post(`${RENTRIApiClient.FORMULARI_PATH}/`, dati, '/formulari (crea)', tenantId),
      '/formulari (crea)',
      tenantId,
      { creazione: true }
    )

    const transazioneId = response.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new TrasmissioneRentriIncertaError('RISPOSTA_SENZA_TRANSAZIONE')
    }
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
      `/formulari/${numeroFir}`,
      tenantId
    )
    return response.data
  }

  /**
   * Legge lo stato corrente del formulario (`GET /{numero_fir}/stato` —
   * formulari.yaml riga 2265, "Consultazione dello stato del formulario").
   * Risposta 200 con corpo `InfoFormulario` (`{versione, stato_formulario}`).
   * Nessun parametro oltre al path — a differenza di
   * {@link leggiAzioniDisponibili}, che richiede `identificativo_soggetto`.
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza};
   * qualunque altro status (es. 400/404) propaga come eccezione non
   * catturata qui — il chiamante (v. `GetAzioniDisponibiliUseCase`) non deve
   * MAI trattare una risposta non-200 come se fosse un aggiornamento di
   * stato valido.
   */
  async leggiStato(tenantId: string, numeroFir: string): Promise<InfoFormularioResult> {
    const response = await this.eseguiRichiestaConResilienza(
      () => this.get(`${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/stato`, tenantId),
      `/formulari/${numeroFir}/stato`,
      tenantId
    )
    return response.data
  }

  /**
   * Legge le operazioni RENTRI disponibili ORA su questo formulario
   * (`GET /{numero_fir}/azioni` — formulari.yaml riga 1330, "Azioni
   * disponibili sul formulario"). Risposta 200 con corpo `AzioniResult`
   * (`{versione, stato, azioni}`).
   *
   * `identificativoSoggetto` (query `identificativo_soggetto`) è
   * OBBLIGATORIO dal contratto (righe 1348-1353): il codice fiscale del
   * soggetto per cui si chiedono le azioni, non un filtro opzionale — senza,
   * l'ente risponde 400 prima ancora di valutare lo stato del formulario.
   * `num_iscr_sito` (opzionale, acquisisce automaticamente la visibilità) è
   * fuori scope di questo metodo: non viene mai inviato.
   *
   * Ogni chiamata a questo metodo È la difesa contro il 423 dell'ente
   * (operazione tentata fuori sequenza): il chiamante deve verificare che
   * l'operazione desiderata compaia in `azioni` PRIMA di invocarla, non
   * fidarsi di una lista letta in precedenza — v. commento di classe di
   * `GetAzioniDisponibiliUseCase`.
   *
   * Errori 403/429/423/5xx sono gestiti da {@link eseguiRichiestaConResilienza};
   * un 400 (es. `identificativo_soggetto` rifiutato) propaga come eccezione
   * non catturata qui, mai come lista vuota silenziosa.
   */
  async leggiAzioniDisponibili(
    tenantId: string,
    numeroFir: string,
    identificativoSoggetto: string
  ): Promise<AzioniDisponibiliResult> {
    const query = new URLSearchParams({ identificativo_soggetto: identificativoSoggetto })
    const response = await this.eseguiRichiestaConResilienza(
      () =>
        this.get(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/azioni?${query.toString()}`,
          tenantId
        ),
      `/formulari/${numeroFir}/azioni`,
      tenantId
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
      '/formulari (ricerca)',
      tenantId
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
      '/formulari (acquisizione-visibilita)',
      tenantId
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
      '/formulari (rilascio-visibilita)',
      tenantId
    )
  }

  // ------------------------------------------------------------------
  // Firma remota RENTRI (R3 Task 3) — servizio `formulari` (contratto
  // ufficiale) + servizio `ca-rentri` (contratto in
  // `docs/contracts/rentri/ca-rentri.yaml`, v. CA_RENTRI_PATH sopra). Tutte queste chiamate passano dagli stessi
  // meccanismi ID_AUTH_REST_02 / INTEGRITY_REST_01 già usati dal resto del
  // client (`post`/`get`): il certificato di INTEROPERABILITÀ che autentica
  // la chiamata resta un oggetto distinto dal certificato di FIRMA REMOTA
  // che viaggia nei corpi.
  // ------------------------------------------------------------------

  /**
   * Richiede il digest da firmare per un formulario
   * (`POST /{numero_fir}/hash` — formulari.yaml riga 1498).
   *
   * **ASYNC (NONBLOCK_PULL)**: la risposta è 202 con `TransazioneModel`; il
   * risultato si attende con {@link attendiEsito}, esattamente come per
   * {@link creaFormulario}. Questo metodo esegue l'intero ciclo e restituisce
   * i due valori che servono al seguito (`digest_to_sign`, `token`).
   *
   * Corpo richiesto: `DatiPerFirmaModel` (formulari.yaml riga 7614) —
   * `certificato` (base64, obbligatorio) e `tipo_firma` (opzionale). Qui
   * `tipo_firma` NON viene inviato: il caso d'uso di questo task è il
   * completamento di un'operazione già a un solo firmatario designato, e
   * inviare un valore inventato cambierebbe il significato della richiesta.
   *
   * L'esito atteso è `EsitoGetHashPerFirmaModel` (riga 9415) dentro il campo
   * polimorfo `esito`: la forma NON viene assunta ma verificata
   * esplicitamente da {@link estraiDatiPerFirmaDaEsito}, stessa cautela di
   * {@link estraiNumeroFirDaEsito}.
   */
  async richiediHashPerFirma(
    tenantId: string,
    numeroFir: string,
    certificatoBase64: string,
    opzioni?: OpzioniPollingEsito
  ): Promise<DatiPerFirma> {
    const contesto = `/formulari/${numeroFir}/hash`
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/hash`,
          { certificato: certificatoBase64 },
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    const esito = await this.attendiEsito(tenantId, transazioneId, opzioni)
    if (esito.errore) {
      throw new Error(
        `L'ente ha rifiutato la richiesta di hash per la firma del formulario ${numeroFir}: ${JSON.stringify(esito.validazione)}`
      )
    }

    const dati = estraiDatiPerFirmaDaEsito(esito)
    if (!dati) {
      throw new Error(
        `L'esito di ${contesto} non contiene 'digest_to_sign'/'token' nella forma prevista da EsitoGetHashPerFirmaModel: impossibile proseguire con la firma.`
      )
    }

    return dati
  }

  /**
   * Trasmette all'ente la firma apposta sul digest
   * (`POST /{numero_fir}/acquisizione-firma` — formulari.yaml riga 531).
   *
   * **ASYNC (NONBLOCK_PULL)**, stesso ciclo di {@link richiediHashPerFirma}.
   * Corpo richiesto: `FirmaModel` (riga 9646) — `certificato` (lo STESSO
   * passato a `/hash`), `token` (quello ricevuto da `/hash`), `firma`
   * (base64 dei byte della firma crittografica).
   *
   * Restituisce l'`EsitoFormularioModel` COSÌ COM'È, senza interpretarlo: la
   * decisione su cosa fare di `esito.errore === true` è del chiamante (v.
   * `CompletaOperazioneConFirmaUseCase`, che in quel caso NON scrive alcuno
   * stato). Questo metodo non solleva eccezione su un esito negativo, perché
   * un esito negativo È una risposta valida dell'ente e va potuta leggere.
   */
  async inviaAcquisizioneFirma(
    tenantId: string,
    numeroFir: string,
    firma: { certificato: string; token: string; firma: string },
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const contesto = `/formulari/${numeroFir}/acquisizione-firma`
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/acquisizione-firma`,
          firma,
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    return this.attendiEsito(tenantId, transazioneId, opzioni)
  }

  /**
   * Trasmette l'accettazione (o il respingimento, anche parziale) di un
   * carico da parte del destinatario (`POST /{numero_fir}/accettazione` —
   * formulari.yaml righe 429-513). Corpo: {@link DatiAccettazionePayload},
   * mappato qui a snake_case (`DatiAccettazioneModel`, righe 6828-6862).
   *
   * **ASYNC (NONBLOCK_PULL)**, stesso ciclo di {@link inviaAcquisizioneFirma}:
   * risposta 202 con `TransazioneModel.transazione_id`, esito atteso con
   * {@link attendiEsito}. Come `inviaAcquisizioneFirma`, restituisce
   * l'`EsitoFormularioModel` COSÌ COM'È, senza interpretare `esito.errore`:
   * quella decisione è del chiamante (`AccettaORespingiFIRUseCase`).
   *
   * Nessun campo `undefined` viene inserito nel corpo HTTP (spread
   * condizionale): il contratto dichiara `additionalProperties: false` su
   * `DatiAccettazioneModel`, e un valore `undefined` esplicito comparirebbe
   * comunque come chiave nel JSON serializzato se scritto come
   * `campo: dati.x ?? undefined`.
   */
  async inviaAccettazione(
    tenantId: string,
    numeroFir: string,
    dati: DatiAccettazionePayload,
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const contesto = `/formulari/${numeroFir}/accettazione`
    const corpo: Record<string, unknown> = {
      tipo_accettazione: dati.tipoAccettazione,
      data_ora_arrivo: dati.dataOraArrivo,
      ...(dati.quantitaAccettataKg !== undefined
        ? { quantita_accettata: dati.quantitaAccettataKg }
        : {}),
      ...(dati.causaleRespingimento !== undefined
        ? { causale_respingimento: dati.causaleRespingimento }
        : {}),
      ...(dati.motivoRespingimento !== undefined
        ? { motivo_respingimento: dati.motivoRespingimento }
        : {}),
      ...(dati.attesaVerificaAnalitica !== undefined
        ? { attesa_verifica_analitica: dati.attesaVerificaAnalitica }
        : {}),
    }

    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/accettazione`,
          corpo,
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    return this.attendiEsito(tenantId, transazioneId, opzioni)
  }

  /**
   * Avvia l'annullamento del FIR digitale (`POST /{numero_fir}/annulla-fir` —
   * formulari.yaml righe 1232-1329, **non** `/annulla`, deprecato riga 1136).
   * **Nessun corpo richiesto dal contratto**: si invia `{}` solo perché `post`
   * calcola sempre la firma di integrità su una stringa (un body `undefined`
   * romperebbe il calcolo del digest — stesso motivo già documentato per
   * {@link acquisisciVisibilita}).
   *
   * **ASYNC (NONBLOCK_PULL)**, stesso ciclo di {@link inviaAccettazione}.
   * Restituisce l'`EsitoFormularioModel` COSÌ COM'È: la decisione su
   * `esito.errore` è del chiamante (`AnnullaFIRRentriUseCase`).
   */
  async annullaFormulario(
    tenantId: string,
    numeroFir: string,
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const contesto = `/formulari/${numeroFir}/annulla-fir`
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/annulla-fir`,
          {},
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    return this.attendiEsito(tenantId, transazioneId, opzioni)
  }

  /**
   * Trasmette le note di annullamento (`POST /{numero_fir}/note-annullamento`
   * — formulari.yaml righe 1642-1738). Corpo: `NoteAnnullamentoModel` (righe
   * 9895-9906), UN SOLO campo, `note` (maxLength 1024) — nome identico in
   * camelCase e snake_case, nessuna mappatura necessaria.
   *
   * Ammesso SOLO quando il formulario è già `Annullato` presso l'ente (il
   * ciclo di firma di {@link annullaFormulario} deve essere già concluso).
   * **Nessuna firma successiva a questa chiamata**, a differenza di
   * `annullaFormulario`: il contratto non documenta uno stato `Firma*` dopo
   * `note-annullamento`.
   *
   * **ASYNC**, stesso ciclo. Restituisce l'esito COSÌ COM'È.
   */
  async inviaNoteAnnullamento(
    tenantId: string,
    numeroFir: string,
    note: string,
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const contesto = `/formulari/${numeroFir}/note-annullamento`
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/note-annullamento`,
          { note },
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    return this.attendiEsito(tenantId, transazioneId, opzioni)
  }

  /**
   * Limite di dimensione del file allegato (byte), **dichiarato dal
   * contratto per QUESTO endpoint** (`DatiAllegatoModel.contenuto`,
   * formulari.yaml riga 6926: "Il contenuto non deve superare 1 MB di
   * dimensione") — NON i limiti di 3 MB (xFIR risultante, stesso paragrafo,
   * vincolo dell'ente sul FIR nel suo complesso, non verificabile lato
   * nostro prima dell'upload) o 5 MB (copia cartacea/xFIR interi, vincoli di
   * altri oggetti). Verificato da {@link GestisciAllegatiFIRUseCase} PRIMA di
   * chiamare {@link caricaAllegato}: un allegato oltre questo limite è una
   * richiesta non valida, e RENTRI conta le richieste non valide contro il
   * chiamante fino al "ban" (423) — non va mai spedita "tanto per vedere".
   */
  static readonly LIMITE_ALLEGATO_BYTES = 1 * 1024 * 1024

  /**
   * Aggiunge un allegato al formulario (`POST /{numero_fir}/allegato` —
   * formulari.yaml righe 776-881). Corpo `DatiAllegatoModel` (righe
   * 6902-6938): `content_type`, `nome_file`, `contenuto` (base64), e
   * `identificativo_soggetto` (CF del soggetto a cui riferire l'allegato,
   * OBBLIGATORIO — non un parametro opzionale). Il campo `descrizione` è
   * deprecato dal contratto: non tradotto.
   *
   * Il contratto dichiara esplicitamente (riga 788): "Il file aggiunto
   * all'xFIR viene inserito all'interno del contenitore ZIP e non necessita
   * di essere firmato" — a differenza di accettazione/annullamento, QUESTA
   * operazione **non** apre un ciclo di firma remota: l'esito del polling
   * NONBLOCK_PULL è definitivo così com'è (nessuna chiamata successiva a
   * `CompletaOperazioneConFirmaUseCase`).
   *
   * **La verifica della dimensione è responsabilità del chiamante**
   * ({@link GestisciAllegatiFIRUseCase}, PRIMA di invocare questo metodo):
   * questo client non ripete la validazione, si limita a tradurre il corpo.
   *
   * **ASYNC (NONBLOCK_PULL)**, stesso ciclo di {@link annullaFormulario}.
   */
  async caricaAllegato(
    tenantId: string,
    numeroFir: string,
    dati: DatiAllegatoPayload,
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const contesto = `/formulari/${numeroFir}/allegato`
    const corpo = {
      content_type: dati.contentType,
      nome_file: dati.nomeFile,
      contenuto: dati.contenutoBase64,
      identificativo_soggetto: dati.identificativoSoggetto,
    }

    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/allegato`,
          corpo,
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    return this.attendiEsito(tenantId, transazioneId, opzioni)
  }

  /**
   * Rimuove un allegato (`DELETE /{numero_fir}/allegato/{allegato_id}` —
   * formulari.yaml righe 941-1017). Nessun corpo nel contratto: nessuna
   * firma di integrità da calcolare (a differenza di {@link post}, che la
   * calcola sempre — v. {@link delete_}).
   *
   * **ASYNC (NONBLOCK_PULL)**, stesso ciclo. Restituisce l'esito COSÌ COM'È:
   * la decisione su `esito.errore` è del chiamante
   * ({@link GestisciAllegatiFIRUseCase}), che deve riflettere l'eliminazione
   * anche in locale SOLO dopo un esito senza errore.
   */
  async eliminaAllegato(
    tenantId: string,
    numeroFir: string,
    allegatoId: number,
    opzioni?: OpzioniPollingEsito
  ): Promise<EsitoFormulario> {
    const contesto = `/formulari/${numeroFir}/allegato/${allegatoId}`
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.delete_(
          `${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/allegato/${allegatoId}`,
          contesto,
          tenantId
        ),
      contesto
    )

    const transazioneId = risposta.data?.transazione_id
    if (typeof transazioneId !== 'string' || transazioneId.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di transazione_id: il ciclo NONBLOCK_PULL non può proseguire.`
      )
    }

    return this.attendiEsito(tenantId, transazioneId, opzioni)
  }

  /**
   * Scarica un allegato (`GET /{numero_fir}/allegato/{allegato_id}` —
   * formulari.yaml righe 882-940). **SINCRONO** (200 diretto, nessun ciclo
   * NONBLOCK_PULL, a differenza di `POST`/`DELETE` sullo stesso path):
   * `DownloadableBaseResponse` (righe 9140-9156) — `nome_file`, `mime`,
   * `content` (base64), tutti nullable per contratto. Restituiti così come
   * arrivano: nessuna verifica che l'ente non dichiari un campo mancante,
   * perché in lettura non c'è alcun 423 da evitare (non è una scrittura).
   */
  async scaricaAllegato(
    tenantId: string,
    numeroFir: string,
    allegatoId: number
  ): Promise<AllegatoScaricato> {
    const contesto = `/formulari/${numeroFir}/allegato/${allegatoId}`
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.get(`${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/allegato/${allegatoId}`, tenantId),
      contesto
    )

    return {
      nomeFile: risposta.data?.nome_file ?? undefined,
      mime: risposta.data?.mime ?? undefined,
      contenutoBase64: risposta.data?.content ?? undefined,
    }
  }

  /**
   * Scarica la stampa PDF del formulario (`GET /{numero_fir}/pdf` —
   * formulari.yaml righe 1739-1789, "Stampa PDF del FIR", R3 Task 7).
   * **SINCRONO** (200/204 diretto, nessun ciclo NONBLOCK_PULL), stessa forma
   * di risposta di {@link scaricaAllegato} (`DownloadableBaseResponse`,
   * righe 9140-9156).
   *
   * Il contratto dichiara ESPLICITAMENTE **204 "No Content"** come esito
   * possibile (riga 1764), distinto da un errore: nessun corpo, nessun
   * `content` da decodificare. Restituito qui come `disponibile: false`,
   * mai sollevato come eccezione — un 204 non è un fallimento della
   * chiamata, è l'ente che dichiara "non c'è ancora un PDF da restituire".
   *
   * Il contratto autorizza questa operazione (riga 1748) a "un'utenza che
   * abbia incarichi per (o coincida con) almeno uno dei soggetti coinvolti
   * nel formulario": QUESTO client non decide l'autorizzazione, si limita a
   * tradurre la risposta dell'ente così come arriva — la verifica è
   * responsabilità del chiamante ({@link ScaricaPdfFirUseCase}, che dichiara
   * esplicitamente quale parte di quel vincolo è verificabile con i dati che
   * abbiamo). Un 403 dell'ente propaga da {@link eseguiRichiestaConResilienza}
   * come qualunque altro errore di questa famiglia.
   */
  async scaricaPdf(tenantId: string, numeroFir: string): Promise<PdfFormularioScaricato> {
    const contesto = `/formulari/${numeroFir}/pdf`
    const risposta = await this.eseguiRichiestaConResilienza(
      () => this.get(`${RENTRIApiClient.FORMULARI_PATH}/${numeroFir}/pdf`, tenantId),
      contesto
    )

    if (risposta.status === 204) {
      return { disponibile: false }
    }

    return {
      disponibile: true,
      nomeFile: risposta.data?.nome_file ?? undefined,
      mime: risposta.data?.mime ?? undefined,
      contenutoBase64: risposta.data?.content ?? undefined,
    }
  }

  /**
   * Legge il certificato X.509 della credenziale di firma remota
   * (`GET /ca-rentri/v1.0/credentials/info`, ca-rentri.yaml:1294). Serve per
   * ottenere il certificato base64 da passare a {@link richiediHashPerFirma} e
   * {@link inviaAcquisizioneFirma}: senza, quei due endpoint non si possono
   * nemmeno chiamare.
   *
   * Contratto: `credentials_id` e' un parametro di **query** obbligatorio
   * (9 caratteri). Si chiede `cert_info=true&certificates=Single`
   * (`CredentialsCertificate`, :2682), cosi' la risposta
   * `CredentialsInfoResponse` (:2779) porta in `cert` (`CertData`, :2346) lo
   * `status` e il solo certificato dell'ente finale in `cert.certificates[0]`
   * (base64 DER). Gli altri campi della risposta vengono ignorati.
   *
   * Errori espliciti, mai una stringa vuota silenziosa: `cert.status` presente
   * e diverso da `Valid` (Expired, Revoked, Suspended) blocca PRIMA di chiedere
   * l'autorizzazione; `cert.certificates` assente o vuoto impedisce di firmare.
   */
  async leggiCertificatoFirmaRemota(tenantId: string, credentialsId: string): Promise<string> {
    const query = new URLSearchParams({
      credentials_id: credentialsId,
      cert_info: 'true',
      certificates: 'Single',
    })
    const contesto = '/ca-rentri/credentials/info'
    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.get(
          `${RENTRIApiClient.CA_RENTRI_PATH}/credentials/info?${query.toString()}`,
          tenantId
        ),
      contesto
    )

    const cert = risposta.data?.cert
    const stato = cert?.status
    if (stato !== undefined && stato !== null && stato !== 'Valid') {
      throw new Error(`Il certificato di firma remota non è valido (stato: ${stato})`)
    }

    const certificato = cert?.certificates?.[0]
    if (typeof certificato !== 'string' || certificato.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di 'cert.certificates': impossibile richiedere il digest da firmare.`
      )
    }
    return certificato
  }

  /**
   * Chiede l'autorizzazione a firmare un digest con la credenziale di firma
   * remota (`POST /ca-rentri/v1.0/credentials/authorize`).
   *
   * Dopo questa chiamata **RENTRI notifica il dispositivo dell'utente**, che
   * conferma con l'app ufficiale *RENTRI FIR Digitale*. Il nostro backend NON
   * chiama mai `PUT /credentials/authorize-confirmation`: quella è l'app
   * dell'utente. Noi rileviamo l'esito con {@link verificaAutorizzazioneFirma}.
   *
   * `num_signatures: 1` e un solo elemento in `hashes`: la documentazione
   * dichiara **massimo un hash per richiesta** su `sign-hash`, e tenere
   * l'autorizzazione allineata alla firma evita un `sad` valido per un
   * insieme diverso da quello che si firmerà.
   *
   * Risposta (`CredentialsAuthorizeResponse`, ca-rentri.yaml:2665): `handle`
   * sempre; `sad` ed `expires_in` (secondi di validità del SAD) **solo se
   * l'autorizzazione è già concessa**, cioè di norma NON qui ma da
   * {@link verificaAutorizzazioneFirma}. Il limite dell'attesa della conferma
   * NON dipende da `expires_in` (durata del SAD): lo fissa il chiamante.
   */
  async autorizzaFirmaRemota(
    tenantId: string,
    richiesta: RichiestaAutorizzazioneFirma
  ): Promise<AutorizzazioneFirmaRemota> {
    const contesto = '/ca-rentri/credentials/authorize'
    const corpo = {
      credentials_id: richiesta.credentialsId,
      num_signatures: 1,
      hashes: [richiesta.digestToSign],
      hash_algo: RENTRIApiClient.HASH_ALGO_SHA256,
      description: richiesta.description,
      client_data: richiesta.clientData ?? null,
    }

    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.CA_RENTRI_PATH}/credentials/authorize`,
          corpo,
          contesto,
          tenantId
        ),
      contesto
    )

    const handle = risposta.data?.handle
    if (typeof handle !== 'string' || handle.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di 'handle': l'autorizzazione alla firma non è utilizzabile.`
      )
    }

    const esito: AutorizzazioneFirmaRemota = { handle }
    const sad = risposta.data?.sad
    if (typeof sad === 'string' && sad.trim() !== '') {
      esito.sad = sad
    }
    const expiresIn = Number(risposta.data?.expires_in)
    if (risposta.data?.expires_in != null && Number.isFinite(expiresIn) && expiresIn > 0) {
      esito.expiresIn = expiresIn
    }
    return esito
  }

  /**
   * Riassume un `ProblemDetails` dell'ente in una riga (`title`, `detail`,
   * `model_state`), o `undefined` se il corpo non ne porta. Non restituisce
   * mai il corpo grezzo.
   */
  private estraiDettaglioProblema(corpo: unknown): string | undefined {
    if (!corpo || typeof corpo !== 'object') return undefined
    const { title, detail, model_state: modelState } = corpo as Record<string, unknown>
    const parti: string[] = []
    if (typeof title === 'string' && title.trim() !== '') parti.push(title.trim())
    if (typeof detail === 'string' && detail.trim() !== '') parti.push(detail.trim())
    if (modelState && typeof modelState === 'object') {
      for (const [campo, messaggi] of Object.entries(modelState as Record<string, unknown>)) {
        const testo = Array.isArray(messaggi) ? messaggi.join('; ') : String(messaggi)
        parti.push(`${campo}: ${testo}`)
      }
    }
    return parti.length > 0 ? parti.join(' - ') : undefined
  }

  /**
   * **UNA SOLA** interrogazione dello stato dell'autorizzazione
   * (`GET /ca-rentri/v1.0/credentials/authorize-check/{handle}`).
   *
   * Deliberatamente NON contiene il ciclo di attesa: il loop vive nello use
   * case (`CompletaOperazioneConFirmaUseCase`), che è l'unico a conoscere
   * `expires_in`, il rate limiter per-tenant e quanto è lecito far attendere
   * l'utente. Un loop nascosto qui dentro renderebbe impossibile al chiamante
   * distinguere «ancora in attesa» da «scaduta» e lo lascerebbe bloccato per
   * un tempo che non ha scelto.
   *
   * **Gli esiti sono tutti TIPIZZATI, nessuno è un'eccezione generica**
   * (codici di ca-rentri.yaml:906-987):
   * - **202** → `IN_ATTESA`: l'utente non ha ancora confermato sul dispositivo.
   * - **200** → `AUTORIZZATA`, con `sad` (obbligatorio: senza è un errore
   *   esplicito) ed `expires_in` (facoltativo) letti dal corpo.
   * - **400** → `SCADUTA`: «autorizzazione scaduta» (il contratto usa il 400
   *   anche per «richiesta non valida»: un difetto di chiamata, qui, si
   *   presenterebbe come scadenza; rischio accettato, l'alternativa renderebbe
   *   indistinguibili due casi invece di uno).
   * - **403** → `RIFIUTATA`: «autorizzazione non concessa».
   * - **422** → errore esplicito: la notifica al dispositivo non è stata
   *   inviata, quindi l'utente non ha nulla da confermare e attendere non ha senso.
   * Il **410 non esiste** nel contratto: cade nella gestione generica.
   *
   * Su 400 e 403 il contratto (ca-rentri.yaml:953-962) accorpa più cause
   * (400: richiesta non valida, credenziali non attive o autorizzazione
   * scaduta; 403: operazione non consentita o autorizzazione non concessa):
   * il `ProblemDetails` dell'ente, se presente, viene riassunto in
   * `dettaglioEnte` (title/detail/model_state) perché il chiamante possa
   * mostrare la causa vera; senza corpo il campo è assente.
   *
   * 400 e 403 sono intercettati QUI, prima di {@link gestisciRispostaNonPrevista},
   * che per uno status non ritentabile solleva un `Error` generico
   * indistinguibile da un guasto: scadenza e rifiuto sono esiti normali del
   * ciclo, che il chiamante traduce in un messaggio utile.
   *
   * `validateStatus` permissivo (come {@link interrogaStatoTransazione}) per
   * poter leggere 202/400/403/422 come dati invece che come eccezioni;
   * 429/423/5xx restano riconosciuti da {@link gestisciRispostaNonPrevista}.
   */
  async verificaAutorizzazioneFirma(
    tenantId: string,
    handle: string
  ): Promise<EsitoVerificaAutorizzazione> {
    const url = `${this.config.baseUrl}${RENTRIApiClient.CA_RENTRI_PATH}/credentials/authorize-check/${handle}`
    const contesto = '/ca-rentri/credentials/authorize-check'

    for (let tentativo = 1; tentativo <= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
      // R5 Task 2: stesso aggancio degli altri cicli di polling di questo
      // client — v. commento di `conRateLimiter`.
      const response = await this.conRateLimiter(tenantEffettivo, async () => {
        const headers = await this.buildAuthHeaders(tenantId)
        return firstValueFrom(
          this.httpService.get(url, {
            headers,
            timeout: this.timeout,
            validateStatus: () => true,
          })
        )
      })

      if (response.status === 202) {
        return { stato: 'IN_ATTESA' }
      }
      if (response.status === 200) {
        const sad = response.data?.sad
        if (typeof sad !== 'string' || sad.trim() === '') {
          throw new Error(
            `Risposta di ${contesto} con 200 ma priva di 'sad': l'autorizzazione alla firma non è utilizzabile.`
          )
        }
        const expiresIn = Number(response.data?.expires_in)
        const esito: EsitoVerificaAutorizzazione = { stato: 'AUTORIZZATA', sad }
        if (response.data?.expires_in != null && Number.isFinite(expiresIn) && expiresIn > 0) {
          esito.expiresIn = expiresIn
        }
        return esito
      }
      // V. commento del metodo: esiti normali del ciclo, non guasti — mappati
      // PRIMA della gestione generica, che li ridurrebbe a un Error anonimo.
      if (response.status === 400 || response.status === 403) {
        const stato = response.status === 400 ? 'SCADUTA' : 'RIFIUTATA'
        const dettaglioEnte = this.estraiDettaglioProblema(response.data)
        if (dettaglioEnte) {
          // Mai il corpo grezzo: solo title/detail/model_state del ProblemDetails.
          this.logger.warn(`${contesto}: l'ente risponde ${response.status} (${stato})`, {
            dettaglioEnte,
          })
          return { stato, dettaglioEnte }
        }
        return { stato }
      }
      if (response.status === 422) {
        throw new Error('La notifica al dispositivo per la firma non è stata inviata')
      }

      await this.gestisciRispostaNonPrevista(response, contesto, tentativo)
      // 'ritenta': si riprova il ciclo (l'attesa è già stata eseguita sopra).
    }

    throw new Error(
      `Superato il numero massimo di tentativi (${RENTRIApiClient.MAX_TENTATIVI_RESILIENZA}) interrogando ${contesto} per l'autorizzazione ${handle}.`
    )
  }

  /**
   * Fa firmare il digest all'HSM di RENTRI
   * (`POST /ca-rentri/v1.0/signatures/sign-hash`). **Un solo hash per
   * richiesta**, come dichiarato dalla documentazione ufficiale.
   *
   * **Forma della risposta dal contratto**: `SignatureResponse { signatures: string[] }`
   * (ca-rentri.yaml righe 3560-3569). Gli elementi corrispondono in ordine a
   * `hashes`: essendone stato inviato uno solo, si legge `signatures[0]`. Una
   * risposta di forma diversa solleva un errore esplicito invece di produrre
   * una "firma" `undefined` che l'ente rifiuterebbe più avanti con un messaggio
   * molto meno comprensibile.
   */
  async firmaHashRemoto(tenantId: string, richiesta: RichiestaFirmaHash): Promise<string> {
    const contesto = '/ca-rentri/signatures/sign-hash'
    const corpo = {
      credentials_id: richiesta.credentialsId,
      sad: richiesta.sad,
      hashes: [richiesta.digestToSign],
      sign_algo: RENTRIApiClient.SIGN_ALGO_ECDSA_SHA256,
    }

    const risposta = await this.eseguiRichiestaConResilienza(
      () =>
        this.post(
          `${RENTRIApiClient.CA_RENTRI_PATH}/signatures/sign-hash`,
          corpo,
          contesto,
          tenantId
        ),
      contesto
    )

    const firme = risposta.data?.signatures
    const firma = Array.isArray(firme) ? firme[0] : undefined
    if (typeof firma !== 'string' || firma.trim() === '') {
      throw new Error(
        `Risposta di ${contesto} priva di 'signatures[0]': nessuna firma da trasmettere all'ente.`
      )
    }
    return firma
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
        const esito = await this.leggiEsitoTransazione(tenantId, stato.urlEsito, transazioneId)
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
      const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
      // R5 Task 2: limitatore preventivo attorno a QUESTO tentativo di
      // polling, stesso aggancio di `eseguiRichiestaConResilienza` — v.
      // commento di `conRateLimiter`.
      const response = await this.conRateLimiter(tenantEffettivo, async () => {
        const headers = await this.buildAuthHeaders(tenantId)
        return firstValueFrom(
          this.httpService.get(url, {
            headers,
            timeout: this.timeout,
            maxRedirects: 0,
            validateStatus: () => true,
          })
        )
      })

      if (response.status === 200) {
        this.metrics.rentriTenantLocked.set({ tenant_id: tenantEffettivo }, 0)
        return { pronto: false }
      }

      if (response.status === 404) {
        throw new TransazioneRentriNonTrovataError(transazioneId)
      }

      if (response.status === 303) {
        this.metrics.rentriTenantLocked.set({ tenant_id: tenantEffettivo }, 0)
        const urlEsito = (response.headers?.location ?? response.headers?.Location) as string
        return { pronto: true, urlEsito }
      }

      await this.gestisciRispostaNonPrevista(
        response,
        `/status (transazione ${transazioneId})`,
        tentativo,
        tenantEffettivo
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
    urlEsito: string | undefined,
    transazioneId: string
  ): Promise<EsitoFormulario | null> {
    if (!urlEsito) {
      throw new Error('Risposta 303 da /status priva di header Location')
    }

    const url = urlEsito.startsWith('http') ? urlEsito : `${this.config.baseUrl}${urlEsito}`

    for (let tentativo = 1; tentativo <= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
      // R5 Task 2: v. commento in `interrogaStatoTransazione`.
      const response = await this.conRateLimiter(tenantEffettivo, async () => {
        const headers = await this.buildAuthHeaders(tenantId)
        return firstValueFrom(
          this.httpService.get(url, {
            headers,
            timeout: this.timeout,
            validateStatus: () => true,
          })
        )
      })

      if (response.status === 404) {
        throw new TransazioneRentriNonTrovataError(transazioneId)
      }

      if (response.status === 400) {
        this.metrics.rentriTenantLocked.set({ tenant_id: tenantEffettivo }, 0)
        return null
      }

      if (response.status === 200) {
        this.metrics.rentriTenantLocked.set({ tenant_id: tenantEffettivo }, 0)
        return response.data
      }

      await this.gestisciRispostaNonPrevista(response, '/result', tentativo, tenantEffettivo)
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
    tentativo: number,
    tenantId?: string
  ): Promise<'ritenta'> {
    return gestisciRispostaErroreRentri(
      risposta,
      contesto,
      tentativo,
      RENTRIApiClient.MAX_TENTATIVI_RESILIENZA,
      this.logger,
      this.metrics,
      ms => this.attendi(ms),
      { baseMs: RENTRIApiClient.BACKOFF_BASE_MS, maxMs: RENTRIApiClient.BACKOFF_MAX_MS },
      tenantId ?? this.tenantIdCorrente()
    )
  }

  /**
   * Esegue `azione` (una chiamata `post()`/`get()` che solleva un'eccezione
   * axios-like su risposta non-2xx) applicando la stessa politica di
   * {@link gestisciRispostaNonPrevista} al ramo di eccezione. `azione` viene
   * rieseguita per intero a ogni tentativo, quindi ogni ritentativo costruisce
   * una nuova autenticazione (nuovo JWT self-issued/`jti`, nuova firma di
   * integrità) invece di riusare quella del tentativo precedente.
   *
   * `opzioni.creazione`: per la POST non idempotente di creazione, 5xx e
   * assenza di risposta non si ritentano ma sollevano
   * {@link TrasmissioneRentriIncertaError}.
   */
  private async eseguiRichiestaConResilienza(
    azione: () => Promise<AxiosResponse>,
    contesto: string,
    tenantId?: string,
    opzioni?: { creazione?: boolean }
  ): Promise<AxiosResponse> {
    const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
    for (let tentativo = 1; tentativo <= RENTRIApiClient.MAX_TENTATIVI_RESILIENZA; tentativo++) {
      try {
        // R5 Task 2: il limitatore protegge QUESTO tentativo, non l'intera
        // operazione — v. commento di `conRateLimiter`.
        return await this.conRateLimiter(tenantEffettivo, azione)
      } catch (error: any) {
        const risposta = error?.response
        if (!risposta || typeof risposta.status !== 'number') {
          // Creazione: senza risposta non si sa se RENTRI abbia registrato il
          // FIR, quindi niente ritentativo e errore tipizzato per il chiamante.
          // Solo se a fallire è la chiamata HTTP (richiesta partita): errori
          // PRIMA dell'invio (auth, firma, rate limiter, bug locali) non hanno
          // raggiunto RENTRI e si rilanciano invariati.
          if (
            opzioni?.creazione &&
            error &&
            typeof error === 'object' &&
            erroriChiamataHttp.has(error)
          ) {
            throw new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA')
          }
          // Nessuna risposta HTTP riconoscibile (es. timeout, errore di rete):
          // comportamento preesistente, invariato.
          throw error
        }

        // Creazione: un 5xx non prova che il FIR non sia stato registrato.
        // 403/429/423 restano com'erano (richiesta non elaborata: ritentare è sicuro).
        if (opzioni?.creazione && risposta.status >= 500) {
          throw new TrasmissioneRentriIncertaError('HTTP_5XX', risposta.status)
        }

        await this.gestisciRispostaNonPrevista(risposta, contesto, tentativo, tenantEffettivo)
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

    // Stesso tenant effettivo per Bearer e firma di integrità.
    const tenantEffettivo = tenantId ?? this.tenantIdCorrente()
    const authorization = await this.auth.creaAuthorizationHeader(tenantEffettivo)
    const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody, tenantEffettivo)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: authorization,
      ...integrityHeaders,
    }

    let response: AxiosResponse
    try {
      response = await firstValueFrom(
        this.httpService.post(url, body, { headers, timeout: this.timeout })
      )
    } catch (error: any) {
      this.metrics.rentriApiErrors.inc({ endpoint: metricEndpoint, error_type: 'HTTP' })
      // Marca l'errore come rifiuto della chiamata HTTP vera e propria (la
      // richiesta è partita): v. `eseguiRichiestaConResilienza`, opzione creazione.
      if (error && typeof error === 'object') {
        erroriChiamataHttp.add(error)
      }
      throw error
    }

    // Risposta non-423 (successo): riporta a 0 il gauge "tenant bandito" se era
    // rimasto a 1 da un precedente 423 confermato. Fuori dal try della POST: un
    // errore di metrica non e' un errore della chiamata (non deve diventare
    // NESSUNA_RISPOSTA) e non deve far perdere l'esito di una POST gia' accettata.
    try {
      this.metrics.rentriTenantLocked.set({ tenant_id: tenantEffettivo }, 0)
    } catch (errore: any) {
      this.logger.warn('Aggiornamento del gauge rentriTenantLocked non riuscito', {
        errore: errore instanceof Error ? errore.message : String(errore),
      })
    }
    return response
  }

  /**
   * GET con Bearer self-issued. V. {@link post} per `tenantId`.
   * `extraHeaders` (es. `Paging-Page`/`Paging-PageSize` di {@link cercaFormulari})
   * si aggiunge all'header di autenticazione, senza sostituirlo.
   */
  private async get(path: string, tenantId?: string, extraHeaders?: Record<string, string>) {
    const url = `${this.config.baseUrl}${path}`
    const headers = { ...(await this.buildAuthHeaders(tenantId)), ...extraHeaders }

    const response = await firstValueFrom(
      this.httpService.get(url, { headers, timeout: this.timeout })
    )
    // V. commento in `post()`: risposta non-423 (successo) riporta a 0 il
    // gauge "tenant bandito".
    this.metrics.rentriTenantLocked.set({ tenant_id: tenantId ?? this.tenantIdCorrente() }, 0)
    return response
  }

  /**
   * DELETE con Bearer self-issued. A differenza di {@link post}, **nessuna
   * firma di integrità**: il contratto non documenta un corpo per
   * `DELETE /{numero_fir}/allegato/{allegato_id}` (formulari.yaml righe
   * 941-1017 — solo path/header, nessun `requestBody`), quindi non c'è
   * niente su cui calcolare il digest RFC 3230. Stesso motivo per cui
   * {@link get} non la calcola.
   */
  private async delete_(path: string, metricEndpoint: string, tenantId?: string) {
    const url = `${this.config.baseUrl}${path}`
    const headers = await this.buildAuthHeaders(tenantId)

    try {
      const response = await firstValueFrom(
        this.httpService.delete(url, { headers, timeout: this.timeout })
      )
      this.metrics.rentriTenantLocked.set({ tenant_id: tenantId ?? this.tenantIdCorrente() }, 0)
      return response
    } catch (error: any) {
      this.metrics.rentriApiErrors.inc({ endpoint: metricEndpoint, error_type: 'HTTP' })
      throw error
    }
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
 * Esito della creazione di un formulario NON noto: la POST (non idempotente)
 * può essere stata elaborata da RENTRI anche se il client non ne ha ricevuto
 * conferma. Ritentare alla cieca creerebbe un doppione, quindi il chiamante
 * deve prima verificare lo stato (es. con la transazione, o cercando il FIR).
 *
 * - `HTTP_5XX`: RENTRI ha risposto 5xx (`status`), ma può aver registrato il FIR.
 * - `NESSUNA_RISPOSTA`: timeout o errore di rete, nessuna risposta HTTP.
 * - `RISPOSTA_SENZA_TRANSAZIONE`: risposta 2xx priva di `transazione_id`.
 */
export class TrasmissioneRentriIncertaError extends Error {
  constructor(
    readonly causa: 'HTTP_5XX' | 'NESSUNA_RISPOSTA' | 'RISPOSTA_SENZA_TRANSAZIONE',
    readonly status?: number
  ) {
    super(
      causa === 'HTTP_5XX'
        ? `RENTRI ha risposto ${status} alla creazione del formulario: esito della trasmissione incerto`
        : causa === 'NESSUNA_RISPOSTA'
          ? 'Nessuna risposta da RENTRI alla creazione del formulario: esito della trasmissione incerto'
          : 'RENTRI ha risposto alla creazione del formulario senza transazione_id: esito della trasmissione incerto'
    )
    this.name = 'TrasmissioneRentriIncertaError'
  }
}

/**
 * RENTRI non conosce la transazione richiesta (404 su `/status` o `/result`,
 * formulari.yaml righe 2847-2897): la creazione non è mai stata registrata
 * oppure l'identificativo non è valido.
 */
export class TransazioneRentriNonTrovataError extends Error {
  constructor(readonly transazioneId: string) {
    super(`RENTRI non ha trovato la transazione ${transazioneId}`)
    this.name = 'TransazioneRentriNonTrovataError'
  }
}

/**
 * Corpo di `POST /{numero_fir}/accettazione` (`DatiAccettazioneModel`,
 * formulari.yaml righe 6828-6862). Solo `tipoAccettazione` e `dataOraArrivo`
 * sono obbligatori nello JSON Schema del contratto: i vincoli condizionali
 * (`quantitaAccettataKg` per 'A'/'P', `causaleRespingimento` +
 * `motivoRespingimento` per 'P'/'R') sono descritti solo in prosa nella
 * `description` di ciascun campo e vanno quindi applicati dal CHIAMANTE
 * (v. `AccettaORespingiFIRUseCase`) PRIMA di costruire questo payload —
 * {@link RENTRIApiClient.inviaAccettazione} non li rivalida.
 */
export interface DatiAccettazionePayload {
  tipoAccettazione: 'A' | 'P' | 'R'
  /** ISO 8601 UTC. */
  dataOraArrivo: string
  quantitaAccettataKg?: number
  causaleRespingimento?: 'NC' | 'IR' | 'A'
  motivoRespingimento?: string
  attesaVerificaAnalitica?: boolean
}

/**
 * Corpo di `POST /{numero_fir}/allegato` (`DatiAllegatoModel`, formulari.yaml
 * righe 6902-6938). `descrizione` non è tradotto: deprecato dal contratto.
 * La verifica di `RENTRIApiClient.LIMITE_ALLEGATO_BYTES` è responsabilità del
 * CHIAMANTE ({@link GestisciAllegatiFIRUseCase}), non di questo payload né
 * del client — v. commento di {@link RENTRIApiClient.caricaAllegato}.
 */
export interface DatiAllegatoPayload {
  /** Sempre `'application/pdf'` per contratto, oggi l'unico valore ammesso. */
  contentType: string
  nomeFile: string
  /** Contenuto del file, GIA' codificato base64 (non i byte grezzi). */
  contenutoBase64: string
  /** CF del soggetto (tra quelli del formulario) a cui riferire l'allegato. */
  identificativoSoggetto: string
}

/**
 * Risposta di `GET /{numero_fir}/allegato/{allegato_id}`
 * (`DownloadableBaseResponse`, formulari.yaml righe 9140-9156): tutti i campi
 * sono nullable per contratto, restituiti così come arrivano.
 */
export interface AllegatoScaricato {
  nomeFile?: string
  mime?: string
  /** Contenuto base64, non decodificato: la decodifica è del chiamante. */
  contenutoBase64?: string
}

/**
 * Risposta di `GET /{numero_fir}/pdf` (R3 Task 7): stessa forma di
 * {@link AllegatoScaricato} (`DownloadableBaseResponse`) più `disponibile`,
 * che distingue il 200 (PDF presente) dal 204 dichiarato dal contratto
 * (righe 1758-1765) — nessun campo è significativo quando `disponibile` è
 * `false`.
 */
export interface PdfFormularioScaricato {
  disponibile: boolean
  nomeFile?: string
  mime?: string
  contenutoBase64?: string
}

/**
 * Estrae `allegato_id` dall'esito di `POST /{numero_fir}/allegato`
 * (`EsitoAddAllegatoModel.allegato_id`, formulari.yaml riga 9163 — una delle
 * varianti del `oneOf` di `EsitoFormularioModel.esito`, stessa cautela di
 * {@link estraiNumeroFirDaEsito}: mai assumere che il campo sia presente).
 *
 * **Limite dichiarato**: la fake RENTRI usata contro l'oracolo accetta
 * qualunque corpo di controllo — questa funzione dimostra che il client
 * legge correttamente `allegato_id` quando è presente nella forma prevista
 * dal contratto, non che l'ente lo restituisca davvero in quella forma.
 */
export function estraiAllegatoIdDaEsito(esito: EsitoFormulario): number | undefined {
  const payload = esito.esito
  if (!payload || typeof payload !== 'object' || !('allegato_id' in payload)) {
    return undefined
  }
  const allegatoId = (payload as { allegato_id?: unknown }).allegato_id
  return typeof allegatoId === 'number' && Number.isFinite(allegatoId) ? allegatoId : undefined
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
 * Esito di `POST /{numero_fir}/hash` (`EsitoGetHashPerFirmaModel`, contratto
 * ufficiale, formulari.yaml riga 9415): una delle varianti del `oneOf` di
 * `EsitoFormularioModel.esito`. `hash_algorithm` e `versione` sono dichiarati
 * dal contratto ma non servono al ciclo di firma remota (l'algoritmo è già
 * fissato dalle costanti OID di {@link RENTRIApiClient}).
 */
export interface EsitoGetHashPerFirmaModel {
  hash_algorithm?: string | null
  digest_to_sign?: string | null
  token?: string | null
  versione?: number | null
}

/** I due valori di `EsitoGetHashPerFirmaModel` necessari a proseguire la firma. */
export interface DatiPerFirma {
  /** Digest base64 da far firmare (è già un hash SHA-256: non va ri-hashato). */
  digestToSign: string
  /** Token opaco da restituire a `/acquisizione-firma` insieme alla firma. */
  token: string
}

/**
 * Estrae `digest_to_sign` e `token` dall'esito di `POST /{numero_fir}/hash`,
 * se e solo se l'esito ha davvero la forma di `EsitoGetHashPerFirmaModel` con
 * entrambi i campi valorizzati con stringhe non vuote. `undefined` in ogni
 * altro caso (altra variante del `oneOf`, `esito` assente, campi mancanti).
 *
 * Stessa cautela di {@link estraiNumeroFirDaEsito} e per lo stesso motivo:
 * `esito` è polimorfo e nessuna sua forma va MAI assunta. Un `digest_to_sign`
 * letto da un esito di tipo diverso porterebbe a far firmare all'utente
 * qualcosa che non è il digest del suo formulario — l'errore peggiore
 * possibile in questa sequenza, e silenzioso.
 */
export function estraiDatiPerFirmaDaEsito(esito: EsitoFormulario): DatiPerFirma | undefined {
  const payload = esito.esito
  if (!payload || typeof payload !== 'object') {
    return undefined
  }
  if (!('digest_to_sign' in payload) || !('token' in payload)) {
    return undefined
  }

  const { digest_to_sign: digestToSign, token } = payload as EsitoGetHashPerFirmaModel
  if (typeof digestToSign !== 'string' || digestToSign.trim() === '') {
    return undefined
  }
  if (typeof token !== 'string' || token.trim() === '') {
    return undefined
  }

  return { digestToSign, token }
}

/** Parametri di {@link RENTRIApiClient.autorizzaFirmaRemota}. */
export interface RichiestaAutorizzazioneFirma {
  credentialsId: string
  /** Il `digest_to_sign` ottenuto da `POST /{numero_fir}/hash`. */
  digestToSign: string
  /**
   * Testo mostrato all'utente sul proprio dispositivo al momento della
   * conferma: è l'unico punto in cui l'utente vede COSA sta autorizzando.
   * Deve essere in italiano e riconoscibile (numero del formulario e
   * operazione), mai un identificativo tecnico.
   */
  description: string
  /** Dati applicativi opzionali del chiamante previsti dal corpo `authorize`. */
  clientData?: string | null
}

/** Risposta di `POST /ca-rentri/v1.0/credentials/authorize`. */
export interface AutorizzazioneFirmaRemota {
  /** Identificativo dell'autorizzazione, da interrogare con `authorize-check/{handle}`. */
  handle: string
  /** Signature Activation Data: presente solo se l'autorizzazione è già concessa. */
  sad?: string
  /** Secondi di validità del `sad`: presente solo se l'autorizzazione è già concessa. */
  expiresIn?: number
}

/**
 * Esiti di {@link RENTRIApiClient.verificaAutorizzazioneFirma}. Tutti tipizzati:
 * `SCADUTA` e `RIFIUTATA` sono esiti NORMALI del ciclo di firma (l'ente li
 * comunica con 400/403), non guasti, e vanno distinguibili a livello di tipo.
 * Il `sad` esiste solo in `AUTORIZZATA`.
 */
export type EsitoVerificaAutorizzazione =
  | { stato: 'IN_ATTESA' }
  | { stato: 'AUTORIZZATA'; sad: string; expiresIn?: number }
  | { stato: 'SCADUTA'; dettaglioEnte?: string }
  | { stato: 'RIFIUTATA'; dettaglioEnte?: string }

/** Parametri di {@link RENTRIApiClient.firmaHashRemoto}. */
export interface RichiestaFirmaHash {
  credentialsId: string
  sad: string
  digestToSign: string
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
 * `Operazione` (`docs/contracts/rentri/formulari.yaml`, riga 9935): le 28
 * operazioni ammesse sul ciclo di vita di un formulario, restituite da
 * `GET /{numero_fir}/azioni` (`AzioniResult.azioni`). Copiate 1:1 dal
 * contratto — non un sottoinsieme — stesso vincolo di fedeltà già applicato
 * a {@link StatoFormulario} (`fir.aggregate.ts`).
 */
export type Operazione =
  | 'Trasporto'
  | 'TrasportoUpdate'
  | 'DatiQuantita'
  | 'DatiQuantitaUpdate'
  | 'Accettazione'
  | 'Allegato'
  | 'Annotazione'
  | 'Reset'
  | 'Rilascia'
  | 'Annulla'
  | 'NoteAnnullamento'
  | 'Hash'
  | 'TrasbordoTotale'
  | 'TrasbordoParziale'
  | 'SostaTecnica'
  | 'NuovoDestinatario'
  | 'AcquisizioneFirma'
  | 'AcquisizioneFirmaAnnullamento'
  | 'AcquisizioneFirmaTrasportatore'
  | 'AcquisizioneFirmaProduttore'
  | 'AcquisizioneFirmaProduttoreTrasportatore'
  | 'AcquisizioneFirmaDestinatario'
  | 'AcquisizioneFirmaAnnotazione'
  | 'AcquisizioneFirmaTrasbordoTotale'
  | 'AcquisizioneFirmaSostaTecnica'
  | 'AcquisizioneFirmaTrasbordoParziale'
  | 'AcquisizioneFirmaDestinatarioSuccessivo'
  | 'AcquisizioneFirmaAccettazioneSuccessiva'
  | 'RollbackFirma'
  | 'Modifica'

/** Corpo della risposta 200 di `GET /{numero_fir}/stato` (`InfoFormulario`, formulari.yaml riga 2265). */
export interface InfoFormularioResult {
  versione: number | null
  stato_formulario: StatoFormulario
}

/** Corpo della risposta 200 di `GET /{numero_fir}/azioni` (`AzioniResult`, formulari.yaml riga 1330). */
export interface AzioniDisponibiliResult {
  versione: number | null
  stato: StatoFormulario
  azioni: Operazione[] | null
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
