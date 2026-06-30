import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainEventsService } from '../../core/domain-events.service'
import { DomainException } from '../../domain/shared/domain-exception'

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

        const rentriResponse = await this.rentriApiClient.submitFIR(fir)

        if (rentriResponse.success) {
          // Success - mark FIR as synced
          fir.markRENTRISynced(rentriResponse.protocolNumber, correlationId)

          // Update sync log
          const duration = Date.now() - startTime
          const successLog = syncLog.markAsSuccess({
            responsePayload: JSON.stringify(rentriResponse),
            protocolNumber: rentriResponse.protocolNumber,
            durationMs: duration,
          })

          // Persist changes
          await this.firRepository.update(firId, fir)
          await this.syncLogRepository.save(successLog)

          // Publish domain events
          await this.publishDomainEvents(fir)

          this.logger.info(`FIR synced to RENTRI successfully`, {
            firId,
            protocolNumber: rentriResponse.protocolNumber,
            duration,
          })

          return {
            success: true,
            protocolNumber: rentriResponse.protocolNumber,
            attempts: fir.rentriSyncStatus.getAttempts(),
          }
        } else {
          // Validation error from RENTRI - permanent failure
          const errorMessage = this.formatRENTRIErrors(rentriResponse.errors)

          fir.markRENTRISyncFailed(errorMessage, 'RENTRI_VALIDATION_ERROR', correlationId)

          const duration = Date.now() - startTime
          const failureLog = syncLog.markAsFailure({
            responsePayload: JSON.stringify(rentriResponse),
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
        // API error - will retry
        const errorMessage = apiError.message || 'RENTRI API error'

        fir.markRENTRISyncFailed(errorMessage, 'RENTRI_API_ERROR', correlationId)

        const duration = Date.now() - startTime
        const failureLog = syncLog.markAsFailure({
          errorMessage,
          errorCode: 'RENTRI_API_ERROR',
          durationMs: duration,
        })

        await this.firRepository.update(firId, fir)
        await this.syncLogRepository.save(failureLog)
        await this.publishDomainEvents(fir)

        const willRetry = fir.needsRENTRIRetry()

        this.logger.warn(`FIR sync to RENTRI failed`, {
          firId,
          error: errorMessage,
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
   * Format RENTRI validation errors
   */
  private formatRENTRIErrors(errors: any[]): string {
    if (!errors || errors.length === 0) {
      return 'Unknown RENTRI error'
    }

    return errors.map(e => `${e.field}: ${e.message}`).join('; ')
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
