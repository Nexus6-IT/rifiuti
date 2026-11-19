import { Injectable, Inject } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { TenantContext } from '../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriAuthService } from './rentri-auth.service'
import {
  RentriApiError,
  estraiProblemDetailsRentri,
  gestisciRispostaErroreRentri,
  attendiMs,
} from './rentri-http-resilienza'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriRateLimiterService } from './rentri-rate-limiter.service'
import { TrasmissioneRentriIncertaError } from './rentri-api.client'
import { EsitoRentriMalformatoError } from './rentri-registri.client'

/**
 * Client del servizio `anagrafiche` di RENTRI
 * (`docs/contracts/rentri/anagrafiche.yaml`): unità locali dell'operatore
 * (R4 Task 3, sola lettura) e registri dell'operatore (pezzo E1 del registro
 * eREGI): elenco per sito, dettaglio, apertura, modifica, chiusura e
 * download della vidimazione virtuale (eREGI, XML firmato dall'ente).
 *
 * **Scritture sui registri.** `POST /operatore/registri` (apertura) e
 * `DELETE /operatore/registri/{id}` (chiusura, irreversibile) non sono
 * idempotenti e NON si ritentano mai su un esito incerto: su 5xx, timeout o
 * connessione chiusa si solleva {@link TrasmissioneRentriIncertaError} e il
 * chiamante verifica per lettura (elenco o dettaglio) prima di fare altro.
 * Si ritentano solo 429/423, dove RENTRI non ha elaborato nulla. `PUT` (stessi
 * valori, stesso risultato) ritenta 429/423/5xx; su timeout o connessione chiusa
 * solleva invece {@link TrasmissioneRentriIncertaError}, come le altre scritture. Le
 * scritture con corpo portano la firma di integrità `Agid-JWT-Signature` e
 * richiedono il tenant esplicito: mai il contesto della richiesta. Il corpo
 * inviato non viene mai loggato.
 *
 * Il testo di {@link TrasmissioneRentriIncertaError} parla di «creazione del
 * formulario» (nasce per i FIR): chi lo mostra a un utente deve tradurlo, la
 * `causa` è l'unico dato affidabile.
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
/** Identificativo del registro (contratto e XSD): `R` + 10 caratteri `[0-9A-Z]`. */
const PATTERN_IDENTIFICATIVO_REGISTRO = /^R[0-9A-Z]{10}$/

/**
 * Prima di costruire un path con l'identificativo: una DELETE irreversibile non
 * deve poter raggiungere un'altra risorsa con `/../` o `?`. Errore tecnico, RENTRI
 * non viene contattato.
 */
function verificaIdentificativoRegistro(identificativo: string): void {
  if (!PATTERN_IDENTIFICATIVO_REGISTRO.test(identificativo)) {
    throw new Error('Identificativo del registro RENTRI non valido')
  }
}

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
    private readonly auth: RentriAuthService,
    // Opzionali come in RentriRegistriClient: le costruzioni dirette dei test di sola lettura restano valide.
    // Le scritture sui registri senza `signature` falliscono subito, prima di toccare la rete.
    private readonly signature?: RentriSignatureService,
    private readonly rateLimiter?: RentriRateLimiterService
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

  // --- Registri dell'operatore (pezzo E1 del registro eREGI) -----------------

  /**
   * `GET /operatore/{num_iscr}/siti/{num_iscr_sito}/registri` (anagrafiche.yaml
   * righe 458-568): elenco paginato dei registri di un'unità locale, filtrabile
   * per codice fiscale dell'operatore, identificativo e flag di chiusura.
   * 404 se operatore o unità locale non esistono.
   */
  async elencaRegistriSito(
    numIscrOperatore: string,
    numIscrSito: string,
    filtri?: FiltriElencoRegistri,
    tenantId?: string
  ): Promise<RisultatoElencoRegistri> {
    const page = filtri?.paging?.page ?? RentriAnagraficheClient.PAGING_PAGE_DEFAULT
    const pageSize = filtri?.paging?.pageSize ?? RentriAnagraficheClient.PAGING_PAGE_SIZE_DEFAULT

    const query = new URLSearchParams()
    if (filtri?.identificativoOperatore !== undefined) {
      query.set('identificativo_operatore', filtri.identificativoOperatore)
    }
    if (filtri?.identificativo !== undefined) query.set('identificativo', filtri.identificativo)
    if (filtri?.chiuso !== undefined) query.set('chiuso', String(filtri.chiuso))
    const querystring = query.toString()

    const contesto = `/operatore/${encodeURIComponent(numIscrOperatore)}/siti/${encodeURIComponent(numIscrSito)}/registri`
    const response = await this.get(
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}${querystring ? `?${querystring}` : ''}`,
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
      risultati: Array.isArray(response.data) ? (response.data as RegistroAnagraficoModel[]) : [],
      paging: {
        page: leggiHeaderNumerico('Paging-Page', page),
        pageSize: leggiHeaderNumerico('Paging-PageSize', pageSize),
        pageCount: leggiHeaderNumerico('Paging-PageCount', 1),
        totalRecordCount: leggiHeaderNumerico('Paging-TotalRecordCount', 0),
      },
    }
  }

  /** `GET /operatore/registri/{identificativo}` (righe 616-): dettaglio. 404 → {@link RentriApiError} «Registro non trovato». */
  async dettaglioRegistro(
    identificativo: string,
    tenantId?: string
  ): Promise<RegistroAnagraficoModel> {
    verificaIdentificativoRegistro(identificativo)
    const contesto = `/operatore/registri/${identificativo}`
    const response = await this.get(
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      tenantId,
      contesto,
      undefined,
      'Registro non trovato'
    )
    return response.data
  }

  /**
   * `POST /operatore/registri` (righe 569-615): apre un nuovo registro.
   * **Non idempotente e mai ritentata su esito incerto** (v. commento di
   * testata): 5xx, timeout o risposta senza `identificativo` →
   * {@link TrasmissioneRentriIncertaError}. 400 → {@link RentriApiError} con
   * titolo/dettaglio dell'ente; 404 (sito non trovato) idem, non ritentabile.
   */
  async apriRegistro(
    richiesta: RichiestaApriRegistro,
    tenantId: string
  ): Promise<{ identificativo: string }> {
    const corpo: Record<string, unknown> = {
      num_iscr_sito: richiesta.numIscrSito,
      attivita: richiesta.attivita,
    }
    if (richiesta.descrizione !== undefined) corpo.descrizione = richiesta.descrizione
    if (richiesta.attivitaRecSmalt !== undefined) {
      corpo.attivita_rec_smalt = richiesta.attivitaRecSmalt
    }

    const contesto = '/operatore/registri'
    const response = await this.scrivi(
      'POST',
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      corpo,
      contesto,
      tenantId,
      { nonIdempotente: true, messaggio404: 'Sito non trovato a registro' }
    )
    const identificativo = response.data?.identificativo
    if (
      typeof identificativo !== 'string' ||
      !PATTERN_IDENTIFICATIVO_REGISTRO.test(identificativo)
    ) {
      throw new TrasmissioneRentriIncertaError('RISPOSTA_SENZA_TRANSAZIONE')
    }
    return { identificativo }
  }

  /**
   * `PUT /operatore/registri/{identificativo}` (righe 616-): modifica
   * descrizione e/o codici di recupero/smaltimento. `forza` (=
   * `forza_salvataggio_attivita_rec_smalt`) salta il controllo dei codici
   * sulle autorizzazioni dell'unità locale. 429/423/5xx ritentati (stessi valori,
   * stesso risultato); su timeout o connessione chiusa
   * {@link TrasmissioneRentriIncertaError}.
   */
  async modificaRegistro(
    identificativo: string,
    modifica: ModificaRegistro,
    tenantId: string
  ): Promise<{ identificativo: string }> {
    const corpo: Record<string, unknown> = {}
    if (modifica.descrizione !== undefined) corpo.descrizione = modifica.descrizione
    if (modifica.attivitaRecSmalt !== undefined)
      corpo.attivita_rec_smalt = modifica.attivitaRecSmalt
    if (modifica.forza !== undefined) corpo.forza_salvataggio_attivita_rec_smalt = modifica.forza

    verificaIdentificativoRegistro(identificativo)
    const contesto = `/operatore/registri/${identificativo}`
    const response = await this.scrivi(
      'PUT',
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      corpo,
      contesto,
      tenantId,
      { nonIdempotente: false, messaggio404: 'Registro non trovato' }
    )
    const id = response.data?.identificativo
    if (typeof id !== 'string' || id.trim() === '') {
      throw new EsitoRentriMalformatoError('risposta di modifica registro senza identificativo')
    }
    return { identificativo: id }
  }

  /**
   * `DELETE /operatore/registri/{identificativo}` (righe 616-): chiude il
   * registro. **Irreversibile**: dopo la chiusura RENTRI non accetta più
   * trasmissioni. Non si ritenta mai su esito incerto (5xx/timeout →
   * {@link TrasmissioneRentriIncertaError}): il chiamante rilegge il dettaglio
   * (`data_chiusura`). Non esiste alcuna chiusura automatica: la decide un utente.
   */
  async chiudiRegistro(identificativo: string, tenantId: string): Promise<void> {
    verificaIdentificativoRegistro(identificativo)
    const contesto = `/operatore/registri/${identificativo}`
    await this.scrivi(
      'DELETE',
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      undefined,
      contesto,
      tenantId,
      { nonIdempotente: true, messaggio404: 'Registro non trovato' }
    )
  }

  /**
   * `GET /operatore/registri/{identificativo}/xml` (righe 756-): vidimazione
   * virtuale (eREGI) firmata dall'ente. Restituisce l'XML decodificato
   * (UTF-8) così com'è, byte per byte: chi lo inserisce in un registro lo fa
   * VERBATIM (la firma dell'ente copre quei byte). Risposta senza `content`
   * o non base64 → {@link EsitoRentriMalformatoError}.
   */
  async scaricaVidimazioneXml(
    identificativo: string,
    tenantId?: string
  ): Promise<{ nomeFile: string | null; mime: string | null; xml: string }> {
    verificaIdentificativoRegistro(identificativo)
    const contesto = `/operatore/registri/${identificativo}/xml`
    const response = await this.get(
      `${RentriAnagraficheClient.ANAGRAFICHE_PATH}${contesto}`,
      tenantId,
      contesto,
      undefined,
      'Registro non trovato'
    )
    const dati = response.data as
      | { nome_file?: string | null; mime?: string | null; content?: string | null }
      | undefined
    const contenuto = dati?.content
    if (
      typeof contenuto !== 'string' ||
      contenuto.length === 0 ||
      !/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(contenuto)
    ) {
      throw new EsitoRentriMalformatoError('vidimazione registro senza contenuto base64 valido')
    }
    const byte = Buffer.from(contenuto, 'base64')
    const xml = byte.toString('utf8')
    // Byte non UTF-8 diventerebbero U+FFFD in silenzio: l'XML che E6 copia sotto la
    // firma dell'ente deve restare identico, quindi fail-closed.
    if (!Buffer.from(xml, 'utf8').equals(byte)) {
      throw new EsitoRentriMalformatoError('vidimazione registro non in UTF-8')
    }
    return { nomeFile: dati?.nome_file ?? null, mime: dati?.mime ?? null, xml }
  }

  /**
   * Scrittura (POST/PUT/DELETE) con Bearer self-issued, firma di integrità sul
   * corpo (se c'è) e rate limiter per tentativo. `nonIdempotente`: 5xx e assenza
   * di risposta NON si ritentano ma sollevano {@link TrasmissioneRentriIncertaError}
   * (la richiesta può essere stata elaborata); altrimenti seguono la resilienza
   * comune. Solo 429/423 si ritentano sempre. Gli errori PRIMA dell'invio (tenant
   * mancante, auth, firma, rate limiter) si rilanciano invariati: RENTRI non è
   * stato raggiunto.
   */
  private async scrivi(
    metodo: 'POST' | 'PUT' | 'DELETE',
    path: string,
    corpo: unknown,
    contesto: string,
    tenantId: string,
    opzioni: { nonIdempotente: boolean; messaggio404: string }
  ) {
    if (!tenantId) {
      throw new Error('Scrittura sui registri RENTRI senza tenant esplicito')
    }
    if (!this.signature && corpo !== undefined) {
      throw new Error('Scrittura sui registri RENTRI senza servizio di firma di integrità')
    }

    const url = `${this.config.baseUrl}${path}`
    const rawBody = corpo === undefined ? undefined : JSON.stringify(corpo)

    for (
      let tentativo = 1;
      tentativo <= RentriAnagraficheClient.MAX_TENTATIVI_RESILIENZA;
      tentativo++
    ) {
      const permesso = this.rateLimiter ? await this.rateLimiter.acquisisci(tenantId) : undefined
      try {
        const headers: Record<string, string> = {
          Authorization: await this.auth.creaAuthorizationHeader(tenantId),
        }
        if (rawBody !== undefined && this.signature) {
          headers['Content-Type'] = 'application/json'
          Object.assign(headers, await this.signature.buildIntegrityHeaders(rawBody, tenantId))
        }

        try {
          const opzioniHttp = { headers, timeout: this.timeout }
          if (metodo === 'POST') {
            return await firstValueFrom(this.httpService.post(url, corpo, opzioniHttp))
          }
          if (metodo === 'PUT') {
            return await firstValueFrom(this.httpService.put(url, corpo, opzioniHttp))
          }
          return await firstValueFrom(this.httpService.delete(url, opzioniHttp))
        } catch (error: any) {
          const risposta = error?.response
          if (!risposta || typeof risposta.status !== 'number') {
            this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
            throw new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA')
          }
          if (risposta.status >= 500 && opzioni.nonIdempotente) {
            this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
            throw new TrasmissioneRentriIncertaError('HTTP_5XX', risposta.status)
          }
          if (risposta.status === 404) {
            this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'NOT_FOUND' })
            throw new RentriApiError(404, 'Non trovato', opzioni.messaggio404, false)
          }
          if (risposta.status === 400) {
            const problema = estraiProblemDetailsRentri(risposta.data)
            this.metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
            throw new RentriApiError(400, problema.title, problema.detail, false)
          }

          // 403 solleva; 429/423/5xx (solo PUT) attendono e si riprova (nuovo giro, nuova firma).
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
            },
            tenantId
          )
        }
      } finally {
        await permesso?.rilascia()
      }
    }

    throw new Error(`Superato il numero massimo di tentativi verso ${contesto}.`)
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
    extraHeaders?: Record<string, string>,
    messaggio404 = 'Operatore o unità locale non trovata'
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
          throw new RentriApiError(404, 'Non trovato', messaggio404, false)
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

/**
 * `RegistroModel` (anagrafiche.yaml componenti): solo i campi che il backend
 * legge, gli altri restano accessibili come `unknown`.
 */
export interface RegistroAnagraficoModel {
  identificativo?: string | null
  descrizione?: string | null
  data_creazione?: string
  data_chiusura?: string | null
  data_modifica?: string | null
  num_iscr_sito?: string | null
  identificativo_operatore_sito?: string | null
  attivita?: string[] | null
  attivita_rec_smalt?: string[] | null
  stato?: 'Attivo' | 'Eliminato' | 'Sospeso' | 'Chiuso' | 'DaConfermare' | null
  uso_locale?: boolean
  [key: string]: unknown
}

/** Filtri di {@link RentriAnagraficheClient.elencaRegistriSito}. */
export interface FiltriElencoRegistri {
  /** Codice fiscale dell'operatore. */
  identificativoOperatore?: string
  identificativo?: string
  chiuso?: boolean
  paging?: { page?: number; pageSize?: number }
}

/** Esito paginato di {@link RentriAnagraficheClient.elencaRegistriSito}. */
export interface RisultatoElencoRegistri {
  risultati: RegistroAnagraficoModel[]
  paging: { page: number; pageSize: number; pageCount: number; totalRecordCount: number }
}

/** Corpo di {@link RentriAnagraficheClient.apriRegistro} (`CreateRegistroRequest`). */
export interface RichiestaApriRegistro {
  numIscrSito: string
  /** CentroRaccolta, Produzione, Recupero, Smaltimento, Trasporto, IntermediazioneSenzaDetenzione. */
  attivita: string[]
  descrizione?: string | null
  /** R1..R13 / D1..D15, richiesti se `attivita` contiene Recupero o Smaltimento. */
  attivitaRecSmalt?: string[] | null
}

/** Corpo di {@link RentriAnagraficheClient.modificaRegistro} (`UpdateRegistroOperatoreRequest`). */
export interface ModificaRegistro {
  descrizione?: string | null
  attivitaRecSmalt?: string[] | null
  forza?: boolean
}
