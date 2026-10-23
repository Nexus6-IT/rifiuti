import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainEventsService } from '../../core/domain-events.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { FIR, FIRStato } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { IDomainEvent } from '../../domain/shared/domain-event.interface'
import { CostruisciPayloadRentri } from './mappatura/costruisci-payload-rentri'
import { DomainError, FirAnnullatoNelFrattempoError } from '../../core/domain/errors'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import {
  RENTRIApiClient,
  RentriApiError,
  TransazioneRentriNonTrovataError,
  TrasmissioneRentriIncertaError,
  estraiNumeroFirDaEsito,
} from '../../infrastructure/rentri/rentri-api.client'

/**
 * Oltre questa età una prenotazione SYNCING è considerata uno stallo (processo
 * morto a metà) e un nuovo tentativo può rilevarla (Decisione 2 del piano B).
 * Deve superare la durata massima di un tentativo vivo: POST + polling.
 */
export const SOGLIA_STALLO_RENTRI_MS = 15 * 60 * 1000

/**
 * Sync FIR to RENTRI Use Case
 *
 * Application service that orchestrates FIR synchronization to RENTRI.
 *
 * Responsibilities:
 * - Load FIR aggregate from repository
 * - Validate FIR can be synced
 * - Call RENTRI API client
 * - Update FIR aggregate with sync result
 * - Persist changes
 * - Publish domain events
 *
 * Follows: Command pattern, Transaction script
 *
 * Ciclo di trasmissione: il contratto ufficiale RENTRI non ha alcun
 * endpoint sincrono di sottomissione — la creazione di un FIR è asincrona
 * (`RENTRIApiClient.creaFormulario`, `POST /` → 202 + `transazione_id`)
 * seguita dal polling NONBLOCK_PULL dell'esito
 * (`RENTRIApiClient.attendiEsito`, ciclo `/status` → `/result`). Questo use
 * case orchestra le due chiamate come un'unica operazione logica di sync:
 * dal punto di vista del chiamante resta un solo `execute()` che attende
 * il risultato finale, ma sotto usa la coppia creazione+polling invece
 * del vecchio `submitFIR` sincrono (mai esposto realmente da RENTRI).
 * Un errore di rete o il superamento del numero massimo di tentativi di
 * polling (v. `RENTRIApiClient.attendiEsito`) sono trattati come lo erano
 * gli errori di rete del vecchio `submitFIR`: retry-abili, non permanenti.
 *
 * Idempotenza (piano B, pezzo 1): al massimo UN formulario per FIR, anche con
 * job concorrenti, polling scaduti, 5xx sulla POST e worker morti a metà.
 * - La prenotazione atomica in DB (`prenotaTrasmissioneRentri`) fa passare un
 *   solo tentativo alla volta; chi la perde esce con `giaInCorso`.
 * - La `transazione_id` del 202 si scrive in DB PRIMA del polling: il tentativo
 *   successivo riprende quella transazione invece di rifare la `POST /`.
 * - Un SYNCING scaduto senza transazione (worker morto fra POST e 202) e ogni
 *   esito incerto della creazione (5xx, nessuna risposta, 404 della
 *   transazione) diventano RENTRI_TRASMISSIONE_INCERTA, non ritentabile: si
 *   riparte solo dopo verifica sul portale (`confermaNuovaTrasmissione`).
 */
@Injectable()
export class SyncFIRToRENTRIUseCase {
  constructor(
    // Interfaccia di dominio: iniettata in produzione tramite la useFactory di
    // RentriSyncModule (vedi rentri-sync.module.ts), che risolve il token
    // esplicitamente — un'interfaccia TS sparisce a runtime e Nest non può
    // risolverla da un tipo di parametro senza un token o senza una factory
    // che la costruisca a mano (il difetto ricorrente in questo progetto:
    // repository iniettati per interfaccia senza @Inject/useFactory falliscono
    // solo a runtime, mai a compile time).
    private readonly firRepository: IFIRRepository,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly syncLogRepository: RENTRISyncLogRepository,
    private readonly domainEvents: DomainEventsService,
    private readonly logger: LoggerService,
    private readonly costruisciPayload: CostruisciPayloadRentri
  ) {
    this.logger.setContext('SyncFIRToRENTRIUseCase')
  }

  /**
   * Execute sync FIR to RENTRI
   */
  async execute(
    firId: string,
    tenantId: string,
    correlationId?: string,
    opzioni?: SyncFIRToRENTRIOpzioni
  ): Promise<SyncFIRToRENTRIResult> {
    const startTime = Date.now()

    try {
      // Load FIR aggregate (riletto dopo la prenotazione, v. sotto)
      let fir = await this.firRepository.findById(firId)

      if (!fir) {
        throw DomainException.notFound('FIR', firId)
      }

      // Tenant isolation check
      if (fir.tenantId !== tenantId) {
        throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
      }

      // Riapertura dopo verifica sul portale: l'operatore ha controllato che il
      // formulario non esista e chiede esplicitamente una nuova POST. Si salva
      // subito, altrimenti la prenotazione troverebbe in DB il blocco.
      if (opzioni?.confermaNuovaTrasmissione) {
        try {
          fir.riapriTrasmissioneDopoVerifica()
        } catch (e) {
          if (e instanceof DomainError || e instanceof DomainException) {
            throw DomainException.businessRuleViolation('CANNOT_SYNC_FIR', e.message)
          }
          throw e
        }
        await this.firRepository.save(fir)
      }

      // Un SYNCING non passa canSyncToRENTRI ma può essere uno stallo da
      // riprendere: lo decide la prenotazione, sulla soglia. Resta quello della
      // prima lettura: dopo la prenotazione il FIR è SYNCING per definizione, e
      // uno stallo nuovo non può nascere nella finestra (servono 15 minuti).
      const eraSyncing = fir.rentriSyncStatus.getStatus() === 'SYNCING'
      if (!eraSyncing && !fir.canSyncToRENTRI()) {
        const reason = this.getSyncBlockReason(fir)
        throw DomainException.businessRuleViolation('CANNOT_SYNC_FIR', reason)
      }

      // Il corpo si costruisce PRIMA del log e prima della chiamata: e' la
      // stessa struttura che finisce nel registro delle trasmissioni e sulla
      // rete, quindi il log non puo' divergere da cio' che e' stato spedito.
      // Se il FIR non ha i dati che il contratto richiede, qui si solleva un
      // errore e la trasmissione non parte affatto. Si costruisce anche prima
      // della prenotazione, cosi' un errore di dati non tocca il DB. Serve solo
      // se la prima lettura indica una trasmissione nuova; la decisione vera la
      // prende la rilettura.
      let payload =
        !fir.rentriTransazioneInAttesa && !eraSyncing
          ? await this.costruisciPayload.costruisci(fir, tenantId)
          : null

      // Un solo istante per prenotazione, aggregate e registrazione della
      // transazione: `registraTransazioneInAttesa` lo confronta per uguaglianza.
      const ora = new Date()
      const prenotato = await this.firRepository.prenotaTrasmissioneRentri(
        firId,
        tenantId,
        ora,
        new Date(ora.getTime() - SOGLIA_STALLO_RENTRI_MS)
      )
      if (!prenotato) {
        this.logger.info(`Trasmissione del FIR a RENTRI già in corso: tentativo saltato`, {
          firId,
          tenantId,
          correlationId,
        })
        return {
          success: false,
          giaInCorso: true,
          willRetry: false,
          attempts: fir.rentriSyncStatus.getAttempts(),
        }
      }

      // Rilettura: fra la prima lettura e la prenotazione un altro job può aver
      // creato il formulario e registrato la sua transazione (poi fallito sul
      // polling, quindi FAILED e riprenotabile). La prenotazione non tocca
      // `rentri_transazione_in_attesa`: il valore riletto è quello che conta
      // per scegliere fra ripresa e nuova POST.
      const riletto = await this.firRepository.findById(firId)
      if (!riletto) throw DomainException.notFound('FIR', firId)
      fir = riletto
      const firPrenotato = riletto
      const transazioneInAttesa = fir.rentriTransazioneInAttesa ?? null

      // Da qui alla POST la prenotazione è nostra ma nulla è partito: un errore
      // la rilascia come FAILED ritentabile, altrimenti fra 15 minuti il
      // SYNCING senza transazione sembrerebbe una POST interrotta.
      await this.primaDellaPost(fir, correlationId, async () =>
        firPrenotato.avviaTentativoRentri(ora)
      )

      // Stallo senza transazione: il worker precedente è morto dopo aver
      // (forse) spedito la POST ma prima del 202. Il formulario può esistere:
      // nessuna nuova POST finché un operatore non verifica.
      if (eraSyncing && !transazioneInAttesa) {
        return this.chiudiTrasmissioneIncerta(
          fir,
          'Trasmissione interrotta prima della risposta di RENTRI: verificare sul portale',
          correlationId,
          null,
          startTime,
          { firId }
        )
      }

      // Create sync log (in ripresa il corpo non si rispedisce: il log dice quale
      // transazione si sta riprendendo). Il corpo si costruisce qui solo se la
      // prima lettura vedeva una transazione che la rilettura non ha più.
      const syncLog = await this.primaDellaPost(fir, correlationId, async () => {
        if (!transazioneInAttesa && !payload) {
          payload = await this.costruisciPayload.costruisci(firPrenotato, tenantId)
        }
        return this.createSyncLog(
          firPrenotato,
          startTime,
          payload ?? { ripresaTransazione: transazioneInAttesa }
        )
      })
      let transazioneId: string | null = transazioneInAttesa
      // Valorizzata solo se la prenotazione è andata persa dopo la POST: l'id va
      // conservato anche nel log finale.
      let transazionePersa: string | null = null

      try {
        // Call RENTRI API
        this.logger.info(`Syncing FIR to RENTRI`, {
          firId,
          tenantId,
          correlationId,
          attempt: fir.rentriSyncStatus.getAttempts() + 1,
          ripresaTransazione: transazioneInAttesa ?? undefined,
        })

        // Crea il formulario (POST asincrono → 202 + transazione_id) e
        // attende l'esito col polling NONBLOCK_PULL (/status → /result).
        // Un errore di polling (rete, superamento tentativi) finisce nel catch
        // sottostante: retry-abile, con la transazione ancora in attesa, così
        // il tentativo successivo riprende il polling senza una nuova POST.
        if (!transazioneId) {
          const creato = await this.rentriApiClient.creaFormulario(tenantId, payload!)
          transazioneId = creato.transazioneId
          if (await this.registraTransazione(fir, tenantId, transazioneId, ora, syncLog)) {
            transazionePersa = transazioneId
          }
        }
        const esito = await this.rentriApiClient.attendiEsito(tenantId, transazioneId)

        if (!esito.errore) {
          // Il numero ufficiale RENTRI vive annidato in `esito.esito`
          // (`EsitoNuovoFormularioModel.numero_fir`, v.
          // `estraiNumeroFirDaEsito`): la `transazione_id` è solo
          // l'identificativo tecnico della chiamata, non il numero del FIR.
          const numeroFir = estraiNumeroFirDaEsito(esito)

          if (!numeroFir) {
            // La transazione RENTRI è stata elaborata senza errori
            // dichiarati, ma l'esito non porta il numero ufficiale: meglio
            // nessun legame che uno inventato sulla transazione tecnica.
            // Senza il numero ufficiale il FIR non soddisfa il criterio di
            // uscita di R0 (rilettura con numero ufficiale) — trattato come
            // fallimento, non come successo silenzioso.
            // Non ritentabile (Decisione 3): la creazione è avvenuta, una nuova
            // POST duplicherebbe il formulario. La transazione è chiusa.
            const errorMessage =
              'Esito RENTRI privo del numero ufficiale (numero_fir): impossibile registrare il legame'

            fir.chiudiTransazioneInAttesa()
            fir.markRENTRISyncFailed(errorMessage, 'RENTRI_MISSING_NUMERO_FIR', correlationId)

            const duration = Date.now() - startTime
            const failureLog = syncLog.markAsFailure({
              responsePayload: rispostaDaRegistrare(esito, transazionePersa),
              errorMessage,
              errorCode: 'RENTRI_MISSING_NUMERO_FIR',
              durationMs: duration,
            })

            const annullatoSenzaNumero = await this.salvaFirSeNonAnnullato(
              fir,
              failureLog,
              ESITO_NON_SALVATO,
              { firId, transazioneId }
            )
            if (annullatoSenzaNumero) return annullatoSenzaNumero
            await this.syncLogRepository.save(failureLog)
            await this.publishDomainEvents(fir)

            this.logger.warn(`FIR sync a RENTRI senza numero ufficiale nell'esito`, {
              firId,
              transazioneId,
            })

            const willRetry = fir.needsRENTRIRetry()

            return {
              success: false,
              error: errorMessage,
              willRetry,
              attempts: fir.rentriSyncStatus.getAttempts(),
              nextRetryAt: willRetry ? fir.getNextRENTRIRetryAt() : undefined,
            }
          }

          // Modalità IBRIDA (opzioni.richiedeConferma): la trasmissione è
          // partita da sola ma il legame NON diventa ufficiale finché un
          // utente non lo conferma esplicitamente (v.
          // `FIR.proporreLegameRENTRI`/`ConfermaLegameRENTRIUseCase`). Ogni
          // altro caso (manuale, batch, automatica) chiude subito il legame
          // come sempre.
          if (opzioni?.richiedeConferma) {
            fir.proporreLegameRENTRI(numeroFir, transazioneId, correlationId)
          } else {
            fir.markRENTRISynced(numeroFir, transazioneId, correlationId)
          }

          // Update sync log
          const duration = Date.now() - startTime
          const successLog = syncLog.markAsSuccess({
            responsePayload: rispostaDaRegistrare(esito, transazionePersa)!,
            protocolNumber: numeroFir,
            durationMs: duration,
          })

          // Persist changes. Se il FIR è stato annullato in locale durante
          // l'attesa dell'esito, l'ente ha comunque il formulario: si conserva il
          // log riuscito e lo si segnala, senza riportare in vita il FIR.
          const annullatoDopoSuccesso = await this.salvaFirSeNonAnnullato(
            fir,
            successLog,
            "FIR annullato in locale durante la trasmissione: sull'ente esiste il formulario",
            { firId, protocolNumber: numeroFir }
          )
          if (annullatoDopoSuccesso) return annullatoDopoSuccesso
          await this.syncLogRepository.save(successLog)

          // Publish domain events
          await this.publishDomainEvents(fir)

          this.logger.info(
            opzioni?.richiedeConferma
              ? `FIR trasmesso a RENTRI, in attesa di conferma esplicita (modalità IBRIDA)`
              : `FIR synced to RENTRI successfully`,
            {
              firId,
              protocolNumber: numeroFir,
              duration,
            }
          )

          return {
            success: true,
            protocolNumber: numeroFir,
            attempts: fir.rentriSyncStatus.getAttempts(),
            inAttesaDiConferma: opzioni?.richiedeConferma ?? false,
          }
        } else {
          // Esito negativo della transazione RENTRI - fallimento permanente
          // (non è un errore di trasporto: la transazione è stata elaborata
          // e ha rifiutato il contenuto del formulario).
          const errorMessage = this.formatEsitoErrors(esito.validazione)

          // Esito letto: la transazione non va più ripresa.
          fir.chiudiTransazioneInAttesa()
          fir.markRENTRISyncFailed(errorMessage, 'RENTRI_VALIDATION_ERROR', correlationId)

          const duration = Date.now() - startTime
          const failureLog = syncLog.markAsFailure({
            responsePayload: rispostaDaRegistrare(esito, transazionePersa),
            errorMessage,
            errorCode: 'RENTRI_VALIDATION_ERROR',
            durationMs: duration,
          })

          const annullatoDopoRifiuto = await this.salvaFirSeNonAnnullato(
            fir,
            failureLog,
            ESITO_NON_SALVATO,
            { firId, transazioneId }
          )
          if (annullatoDopoRifiuto) return annullatoDopoRifiuto
          await this.syncLogRepository.save(failureLog)
          await this.publishDomainEvents(fir)

          return {
            success: false,
            error: errorMessage,
            willRetry: false, // Validation errors don't retry
            attempts: fir.rentriSyncStatus.getAttempts(),
          }
        }
      } catch (apiError: any) {
        // Un FIR annullato nel frattempo non è un errore dell'ente: niente
        // secondo salvataggio, che verrebbe rifiutato allo stesso modo.
        if (apiError instanceof FirAnnullatoNelFrattempoError) throw apiError

        // Creazione dall'esito incerto (5xx, nessuna risposta, 202 senza
        // transazione) o transazione che RENTRI non conosce (404): il formulario
        // può esistere o no, e solo il portale lo dice. Non ritentabile.
        if (
          apiError instanceof TrasmissioneRentriIncertaError ||
          apiError instanceof TransazioneRentriNonTrovataError
        ) {
          return this.chiudiTrasmissioneIncerta(
            fir,
            `${apiError.message}: verificare sul portale RENTRI prima di ritrasmettere`,
            correlationId,
            syncLog,
            startTime,
            { firId, transazioneId },
            rispostaDaRegistrare(undefined, transazionePersa)
          )
        }

        // 403 (RentriApiError.retryable === false): credenziale non valida o
        // operazione non consentita. Ritentare non ha senso — la credenziale
        // resterà invalida al tentativo successivo — quindi l'esito è
        // SEMPRE definitivo, indipendentemente da fir.needsRENTRIRetry().
        // Per ogni altro errore (rete/timeout, o un RentriApiError con
        // retryable === true dopo l'esaurimento dei tentativi di resilienza
        // del client) resta valida la semantica precedente: retry-abile.
        const nonRitentabile = apiError instanceof RentriApiError && !apiError.retryable

        // Solo title/detail del ProblemDetails finiscono nel messaggio (log +
        // log di sincronizzazione): mai il corpo grezzo della risposta RENTRI.
        const errorMessage =
          apiError instanceof RentriApiError
            ? (apiError.problemDetail ?? apiError.problemTitle ?? apiError.message)
            : apiError.message || 'RENTRI API error'

        // 429/423 sono una famiglia a parte rispetto a 5xx/rete (R1 Task 5):
        // l'ente ha sospeso le richieste (423 = ha bandito il chiamante per
        // troppe richieste non valide), il messaggio all'utente deve dirlo
        // esplicitamente e MAI offrire un «Riprova» manuale — un ritentativo
        // qui peggiora la situazione, a differenza di un 5xx/timeout dove
        // ritentare più tardi è normale. `apiError.status` esiste solo se
        // l'errore è un RentriApiError (v. RENTRIApiClient); un errore di
        // rete/timeout puro non ha uno status HTTP e ricade in
        // RENTRI_API_ERROR come sempre.
        const status = apiError instanceof RentriApiError ? apiError.status : undefined
        const errorCode = nonRitentabile
          ? 'RENTRI_FORBIDDEN'
          : status === 429 || status === 423
            ? 'RENTRI_RATE_LIMITED'
            : 'RENTRI_API_ERROR'

        // Transazione accettata dall'ente ma esito illeggibile, e questo
        // fallimento chiuderebbe il FIR per sempre (codice non ritentabile o
        // tentativi esauriti): il formulario può esistere, quindi si passa da
        // trasmissione incerta, l'unico blocco che un operatore può riaprire.
        // "Definitivo" lo calcola il VO (immutabile, nessun effetto sul FIR).
        if (
          fir.rentriTransazioneInAttesa &&
          !fir.rentriSyncStatus.markAsFailed(errorMessage || errorCode, errorCode).canRetry()
        ) {
          return this.chiudiTrasmissioneIncerta(
            fir,
            `Esito della trasmissione non leggibile (${errorMessage}): verificare sul portale RENTRI se il formulario esiste`,
            correlationId,
            syncLog,
            startTime,
            { firId, transazioneId, errorCode },
            rispostaDaRegistrare(undefined, transazionePersa)
          )
        }

        fir.markRENTRISyncFailed(errorMessage, errorCode, correlationId)

        const duration = Date.now() - startTime
        const failureLog = syncLog.markAsFailure({
          responsePayload: rispostaDaRegistrare(undefined, transazionePersa),
          errorMessage,
          errorCode,
          durationMs: duration,
        })

        const annullatoDopoErrore = await this.salvaFirSeNonAnnullato(
          fir,
          failureLog,
          ESITO_NON_SALVATO,
          { firId, errorCode }
        )
        if (annullatoDopoErrore) return annullatoDopoErrore
        await this.syncLogRepository.save(failureLog)
        await this.publishDomainEvents(fir)

        const willRetry = nonRitentabile ? false : fir.needsRENTRIRetry()

        this.logger.warn(`FIR sync to RENTRI failed`, {
          firId,
          error: errorMessage,
          errorCode,
          attempt: fir.rentriSyncStatus.getAttempts(),
          willRetry,
        })

        return {
          success: false,
          error: errorMessage,
          willRetry,
          attempts: fir.rentriSyncStatus.getAttempts(),
          nextRetryAt: willRetry ? fir.getNextRENTRIRetryAt() : undefined,
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to sync FIR to RENTRI`, error, {
        firId,
        tenantId,
        correlationId,
      })
      throw error
    }
  }

  /**
   * Salva il FIR dopo la trasmissione. Se nel frattempo è stato annullato in
   * locale, il repository rifiuta il salvataggio (`FirAnnullatoNelFrattempoError`):
   * si conserva il log di sincronizzazione, si scrive un errore nel log applicativo
   * e si restituisce un esito definitivo, senza nuovi tentativi (un retry
   * troverebbe lo stesso FIR annullato). Restituisce `null` se il salvataggio è
   * riuscito; ogni altro errore risale invariato.
   */
  private async salvaFirSeNonAnnullato(
    fir: FIR,
    logSincronizzazione: any | null,
    messaggio: string,
    contesto: Record<string, unknown>
  ): Promise<SyncFIRToRENTRIResult | null> {
    try {
      await this.firRepository.save(fir)
      return null
    } catch (e) {
      if (!(e instanceof FirAnnullatoNelFrattempoError)) throw e
      if (logSincronizzazione) await this.syncLogRepository.save(logSincronizzazione)
      this.logger.error(messaggio, e, contesto)
      return {
        success: false,
        error: e.message,
        willRetry: false,
        attempts: fir.rentriSyncStatus.getAttempts(),
      }
    }
  }

  /**
   * Trasmissione dall'esito incerto: il FIR passa a RENTRI_TRASMISSIONE_INCERTA
   * (PERMANENTLY_FAILED, transazione in attesa chiusa) e resta fermo finché un
   * operatore non verifica sul portale. `syncLog` è null quando non c'è stata
   * alcuna chiamata in questo tentativo (stallo senza transazione).
   */
  private async chiudiTrasmissioneIncerta(
    fir: FIR,
    motivo: string,
    correlationId: string | undefined,
    syncLog: RENTRISyncLog | null,
    startTime: number,
    contesto: Record<string, unknown>,
    responsePayload?: string
  ): Promise<SyncFIRToRENTRIResult> {
    fir.segnaTrasmissioneIncerta(motivo, correlationId)

    const failureLog =
      syncLog?.markAsFailure({
        responsePayload,
        errorMessage: motivo,
        errorCode: 'RENTRI_TRASMISSIONE_INCERTA',
        durationMs: Date.now() - startTime,
      }) ?? null

    const annullato = await this.salvaFirSeNonAnnullato(
      fir,
      failureLog,
      ESITO_NON_SALVATO,
      contesto
    )
    if (annullato) return annullato
    if (failureLog) await this.syncLogRepository.save(failureLog)
    await this.publishDomainEvents(fir)

    this.logger.warn(`Trasmissione del FIR a RENTRI dall'esito incerto: serve una verifica`, {
      ...contesto,
      motivo,
    })

    return {
      success: false,
      error: motivo,
      willRetry: false,
      attempts: fir.rentriSyncStatus.getAttempts(),
    }
  }

  /**
   * Registra la transazione accettata dall'ente, in DB e nell'aggregate, prima
   * del polling. Se il DB risponde che la prenotazione non è più di questo
   * tentativo (soglia scaduta e FIR riprenotato), NON si abbandona: perdere
   * l'id dopo una POST riuscita è proprio il doppione da evitare. L'id finisce
   * subito nel log di sync, si avvisa e si prosegue il polling; un esito
   * positivo salva comunque il legame (`rentri_numero_fir` non è fra le colonne
   * che `save` protegge) e blocca nuove prenotazioni. Restituisce true se la
   * prenotazione era persa: il chiamante conserva l'id anche nel log finale.
   */
  private async registraTransazione(
    fir: FIR,
    tenantId: string,
    transazioneId: string,
    avviatoAt: Date,
    syncLog: RENTRISyncLog
  ): Promise<boolean> {
    // Prima in memoria: se la scrittura in DB fallisce, il salvataggio del ramo
    // d'errore porta comunque la transazione in attesa.
    fir.registraTransazioneInAttesa(transazioneId)
    const registrata = await this.firRepository.registraTransazioneInAttesa(
      fir.id,
      tenantId,
      transazioneId,
      avviatoAt
    )
    if (registrata) return false

    // Stesso id del log: l'esito finale lo aggiorna (upsert).
    await this.syncLogRepository.save(
      syncLog.conResponsePayload(rispostaDaRegistrare(undefined, transazioneId)!)
    )
    this.logger.warn(
      `Prenotazione RENTRI persa dopo la creazione del formulario: si prosegue il polling`,
      { firId: fir.id, transazioneId }
    )
    return true
  }

  /**
   * Passi fra la prenotazione e la POST: se uno solleva, nulla è stato spedito,
   * quindi il tentativo si chiude come FAILED ritentabile (RENTRI_API_ERROR) e
   * l'errore risale come oggi. Un fallimento di questo rilascio si registra e
   * non copre l'errore originale.
   */
  private async primaDellaPost<T>(
    fir: FIR,
    correlationId: string | undefined,
    passo: () => Promise<T>
  ): Promise<T> {
    try {
      return await passo()
    } catch (errore: any) {
      try {
        fir.markRENTRISyncFailed(
          errore?.message || 'Errore prima della trasmissione a RENTRI',
          'RENTRI_API_ERROR',
          correlationId
        )
        await this.firRepository.save(fir)
      } catch (rilascio) {
        this.logger.error(`Rilascio della prenotazione RENTRI non riuscito`, rilascio, {
          firId: fir.id,
        })
      }
      throw errore
    }
  }

  /**
   * Create sync log entry
   */
  private async createSyncLog(fir: FIR, _startTime: number, payload: Record<string, unknown>) {
    const syncLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      firId: fir.id,
      tenantId: fir.tenantId ?? '',
      attempt: fir.rentriSyncStatus.getAttempts() + 1,
      requestPayload: JSON.stringify(payload),
    }

    return this.syncLogRepository.createPending(syncLog)
  }

  /**
   * Publish domain events from FIR aggregate
   *
   * NOTA: gli eventi emessi dall'aggregate FIR (`FIREmessoEvent`,
   * `FIRConsegnatoEvent`, ecc., v. `domain/fir/aggregates/fir.aggregate.ts`)
   * implementano `DomainEvent` (`{occurredOn, eventName}`, da
   * `core/domain/aggregate-root.ts`) — un'interfaccia diversa da `IDomainEvent`
   * (`{eventId, aggregateId, eventType, tenantId, payload, ...}`, da
   * `domain/shared/domain-event.interface.ts`) attesa da
   * `DomainEventsService.publish`. Le due famiglie di eventi sono rimaste
   * incompatibili (nessun `.register(...)` esiste ancora nel progetto): il
   * cast sotto rende il codice compilabile con i tipi reali (niente più
   * `any`) ma NON risolve la disallineanza — finché non esiste un adattatore
   * tra le due forme, `DomainEventsService` non troverà mai un handler per
   * questi eventi (vedi report R0 Task 4).
   */
  private async publishDomainEvents(fir: FIR): Promise<void> {
    const events = fir.getDomainEvents()
    for (const event of events) {
      await this.domainEvents.publish(event as unknown as IDomainEvent)
    }
    fir.clearDomainEvents()
  }

  /**
   * Get reason why FIR cannot be synced (v. `FIR.canSyncToRENTRI` per le
   * regole di dominio: stato emesso, non già legato, tentativi disponibili).
   */
  private getSyncBlockReason(fir: FIR): string {
    const statoEmesso =
      fir.stato === FIRStato.EMESSO ||
      fir.stato === FIRStato.IN_TRANSITO ||
      fir.stato === FIRStato.CONSEGNATO

    if (!statoEmesso) {
      return `FIR deve essere emesso prima della trasmissione a RENTRI. Stato attuale: ${fir.stato}`
    }

    if (fir.rentriNumeroFir) {
      return `FIR già legato al numero RENTRI: ${fir.rentriNumeroFir}`
    }

    if (fir.rentriSyncStatus.getStatus() === 'PERMANENTLY_FAILED') {
      return 'Sincronizzazione RENTRI fallita definitivamente. Richiesto intervento manuale.'
    }

    return 'FIR non trasmissibile a RENTRI in questo momento'
  }

  /**
   * Formatta i messaggi di validazione di un esito RENTRI negativo
   * (`EsitoFormularioModel.validazione`, contratto ufficiale — ciascun
   * elemento è un `EsitoMessaggioModel` con `campo`/`codice_messaggio`).
   * Accetta anche la forma legacy `{field, message}` per retrocompatibilità
   * con chiamanti che non parlano ancora il contratto ufficiale.
   */
  private formatEsitoErrors(validazione: any[]): string {
    if (!validazione || validazione.length === 0) {
      return 'Unknown RENTRI error'
    }

    return validazione
      .map(v => `${v.campo ?? v.field ?? '?'}: ${v.codice_messaggio ?? v.message ?? 'errore'}`)
      .join('; ')
  }
}

/**
 * `responsePayload` del log di sync. Se la prenotazione è andata persa dopo la
 * POST, la transazione si aggiunge in chiaro accanto ai campi dell'esito (che
 * restano al primo livello: `rentri-error-presentation` vi legge `validazione`),
 * così l'id sopravvive anche al log finale.
 */
function rispostaDaRegistrare(
  esito: object | undefined,
  transazionePersa: string | null
): string | undefined {
  if (transazionePersa) {
    return JSON.stringify({
      ...(esito ?? {}),
      transazioneId: transazionePersa,
      prenotazionePersa: true,
    })
  }
  return esito === undefined ? undefined : JSON.stringify(esito)
}

const ESITO_NON_SALVATO =
  "FIR annullato in locale durante la trasmissione: l'esito dell'ente non viene salvato sul FIR"

/**
 * Result of sync operation
 */
export interface SyncFIRToRENTRIResult {
  success: boolean
  protocolNumber?: string
  error?: string
  willRetry?: boolean
  attempts: number
  nextRetryAt?: Date | null
  /** true se il successo NON ha ancora legato il FIR: in attesa di conferma esplicita (modalità IBRIDA). */
  inAttesaDiConferma?: boolean
  /** true se un altro tentativo tiene la prenotazione: nessuna chiamata a RENTRI, niente da ritentare. */
  giaInCorso?: boolean
}

/**
 * Opzioni di esecuzione della sync, decise dalla modalità del tenant
 * (v. `TrasmettiFIRSecondoModalitaUseCase`).
 */
export interface SyncFIRToRENTRIOpzioni {
  /**
   * Modalità IBRIDA: un esito positivo non chiude subito il legame
   * (`FIR.proporreLegameRENTRI` invece di `FIR.markRENTRISynced`) — resta in
   * attesa di conferma esplicita dell'utente.
   */
  richiedeConferma?: boolean
  /**
   * Un operatore ha verificato sul portale che il formulario non esiste:
   * riapre una trasmissione incerta (o un esito senza numero_fir) e consente
   * una nuova `POST /`. Su un FIR non bloccato così è CANNOT_SYNC_FIR.
   */
  confermaNuovaTrasmissione?: boolean
}
