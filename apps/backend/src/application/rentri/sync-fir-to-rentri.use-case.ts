import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainEventsService } from '../../core/domain-events.service'
import { DomainException } from '../../domain/shared/domain-exception'
import {
  RentriApiError,
  estraiNumeroFirDaEsito,
} from '../../infrastructure/rentri/rentri-api.client'

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
 */
@Injectable()
export class SyncFIRToRENTRIUseCase {
  constructor(
    private readonly firRepository: any, // IFIRRepository - will be injected
    private readonly rentriApiClient: any, // RENTRIApiClient - will be injected
    private readonly syncLogRepository: any, // IRENTRISyncLogRepository - will be injected
    private readonly domainEvents: DomainEventsService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('SyncFIRToRENTRIUseCase')
  }

  /**
   * Execute sync FIR to RENTRI
   */
  async execute(
    firId: string,
    tenantId: string,
    correlationId?: string
  ): Promise<SyncFIRToRENTRIResult> {
    const startTime = Date.now()

    try {
      // Load FIR aggregate
      const fir = await this.firRepository.findById(firId)

      if (!fir) {
        throw DomainException.notFound('FIR', firId)
      }

      // Tenant isolation check
      if (fir.tenantId !== tenantId) {
        throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
      }

      // Validate FIR can be synced
      if (!fir.canSyncToRENTRI()) {
        const reason = this.getSyncBlockReason(fir)
        throw DomainException.businessRuleViolation('CANNOT_SYNC_FIR', reason)
      }

      // Mark sync as starting
      fir.startRENTRISync()

      // Create sync log
      const syncLog = await this.createSyncLog(fir, startTime)

      try {
        // Call RENTRI API
        this.logger.info(`Syncing FIR to RENTRI`, {
          firId,
          tenantId,
          correlationId,
          attempt: fir.rentriSyncStatus.getAttempts() + 1,
        })

        // Crea il formulario (POST asincrono → 202 + transazione_id) e
        // attende l'esito col polling NONBLOCK_PULL (/status → /result).
        // Un errore qui (rete, timeout, superamento tentativi di polling)
        // finisce nel catch sottostante: stessa semantica retry-abile che
        // aveva un errore di rete del vecchio submitFIR.
        const { transazioneId } = await this.rentriApiClient.creaFormulario(
          tenantId,
          this.convertFIRToPayload(fir)
        )
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
            const errorMessage =
              'Esito RENTRI privo del numero ufficiale (numero_fir): impossibile registrare il legame'

            fir.markRENTRISyncFailed(errorMessage, 'RENTRI_MISSING_NUMERO_FIR', correlationId)

            const duration = Date.now() - startTime
            const failureLog = syncLog.markAsFailure({
              responsePayload: JSON.stringify(esito),
              errorMessage,
              errorCode: 'RENTRI_MISSING_NUMERO_FIR',
              durationMs: duration,
            })

            await this.firRepository.update(firId, fir)
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

          fir.markRENTRISynced(numeroFir, transazioneId, correlationId)

          // Update sync log
          const duration = Date.now() - startTime
          const successLog = syncLog.markAsSuccess({
            responsePayload: JSON.stringify(esito),
            protocolNumber: numeroFir,
            durationMs: duration,
          })

          // Persist changes
          await this.firRepository.update(firId, fir)
          await this.syncLogRepository.save(successLog)

          // Publish domain events
          await this.publishDomainEvents(fir)

          this.logger.info(`FIR synced to RENTRI successfully`, {
            firId,
            protocolNumber: numeroFir,
            duration,
          })

          return {
            success: true,
            protocolNumber: numeroFir,
            attempts: fir.rentriSyncStatus.getAttempts(),
          }
        } else {
          // Esito negativo della transazione RENTRI - fallimento permanente
          // (non è un errore di trasporto: la transazione è stata elaborata
          // e ha rifiutato il contenuto del formulario).
          const errorMessage = this.formatEsitoErrors(esito.validazione)

          fir.markRENTRISyncFailed(errorMessage, 'RENTRI_VALIDATION_ERROR', correlationId)

          const duration = Date.now() - startTime
          const failureLog = syncLog.markAsFailure({
            responsePayload: JSON.stringify(esito),
            errorMessage,
            errorCode: 'RENTRI_VALIDATION_ERROR',
            durationMs: duration,
          })

          await this.firRepository.update(firId, fir)
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

        const errorCode = nonRitentabile ? 'RENTRI_FORBIDDEN' : 'RENTRI_API_ERROR'

        fir.markRENTRISyncFailed(errorMessage, errorCode, correlationId)

        const duration = Date.now() - startTime
        const failureLog = syncLog.markAsFailure({
          errorMessage,
          errorCode,
          durationMs: duration,
        })

        await this.firRepository.update(firId, fir)
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
   * Create sync log entry
   */
  private async createSyncLog(fir: any, _startTime: number): Promise<any> {
    const syncLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      firId: fir.id,
      tenantId: fir.tenantId,
      attempt: fir.rentriSyncStatus.getAttempts() + 1,
      requestPayload: JSON.stringify(this.convertFIRToPayload(fir)),
    }

    return this.syncLogRepository.createPending(syncLog)
  }

  /**
   * Publish domain events from FIR aggregate
   */
  private async publishDomainEvents(fir: any): Promise<void> {
    const events = fir.getDomainEvents()
    for (const event of events) {
      await this.domainEvents.publish(event)
    }
    fir.clearDomainEvents()
  }

  /**
   * Get reason why FIR cannot be synced
   */
  private getSyncBlockReason(fir: any): string {
    if (fir.status !== 'COMPLETED') {
      return `FIR must be completed before sync. Current status: ${fir.status}`
    }

    if (fir.rentriSyncStatus.getStatus() === 'SYNCED') {
      return `FIR already synced with protocol: ${fir.rentriSyncStatus.getProtocolNumber()}`
    }

    if (fir.rentriSyncStatus.getStatus() === 'PERMANENTLY_FAILED') {
      return 'FIR sync permanently failed. Manual intervention required.'
    }

    return 'FIR cannot be synced'
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

  /**
   * Convert FIR to RENTRI payload (simplified - actual conversion in API client)
   */
  private convertFIRToPayload(fir: any): any {
    return {
      firId: fir.id,
      firNumber: fir.firNumber,
      // ... other fields
    }
  }
}

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
}
