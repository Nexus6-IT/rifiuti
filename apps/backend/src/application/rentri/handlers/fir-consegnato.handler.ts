import { Injectable } from '@nestjs/common'
import { IDomainEventHandler } from '../../../domain/shared/domain-event.interface'
import { LoggerService } from '../../../core/logger/logger.service'

/**
 * FIR Consegnato Event Handler
 *
 * Automatically triggers RENTRI sync when FIR is completed (consegnato = delivered).
 * This is the event emitted when receiver signs the FIR, completing the workflow.
 *
 * Handler responsibilities:
 * - Listen for FIRConsegnatoEvent (FIR completed)
 * - Queue RENTRI sync job with delay
 * - Log sync trigger for audit
 */
@Injectable()
export class FIRConsegnatoHandler implements IDomainEventHandler {
  constructor(
    private readonly rentriSyncQueue: any, // RENTRISyncQueue
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('FIRConsegnatoHandler')
  }

  /**
   * Handle FIR Consegnato event
   */
  async handle(event: any): Promise<void> {
    const { aggregateId: firId, tenantId, correlationId } = event

    this.logger.info('FIR consegnato - triggering RENTRI sync', {
      firId,
      tenantId,
      correlationId,
      eventType: event.eventType,
    })

    try {
      // Queue RENTRI sync job with 5-minute delay
      // This gives time for any final updates and avoids overwhelming RENTRI API
      const jobId = await this.rentriSyncQueue.addSyncJob({
        firId,
        tenantId,
        correlationId,
        delay: 5 * 60 * 1000, // 5 minutes
        priority: 'normal',
      })

      this.logger.info('RENTRI sync job queued', {
        firId,
        jobId,
        delayMinutes: 5,
      })
    } catch (error: any) {
      this.logger.error('Failed to queue RENTRI sync job', error, {
        firId,
        tenantId,
        correlationId,
      })
      // Don't throw - event handling should be resilient
      // Sync can be triggered manually if this fails
    }
  }
}
