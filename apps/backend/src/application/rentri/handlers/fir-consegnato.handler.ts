import { Injectable } from '@nestjs/common'
import { IDomainEvent, IDomainEventHandler } from '../../../domain/shared/domain-event.interface'
import { LoggerService } from '../../../core/logger/logger.service'
import { RENTRISyncQueue } from '../../../infrastructure/queue/rentri-sync.queue'

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
 *
 * NOTA (R0 Task 4): questo handler è scritto per l'interfaccia `IDomainEvent`
 * (`eventType`/`aggregateId`/`tenantId`), ma il `FIRConsegnatoEvent` reale
 * emesso da `FIR.confermaConsegna()` implementa l'altra famiglia di eventi
 * del progetto (`DomainEvent` con `eventName`/`firId`, v.
 * `core/domain/aggregate-root.ts`) e NON viene mai pubblicato su
 * `DomainEventsService` (nessuna chiamata `.register(...)` esiste nel
 * progetto). Il pezzo è cablato in DI (non più orfano da Nest, v.
 * `rentri-sync.module.ts`) ma NON scatta ancora automaticamente alla
 * consegna: farlo richiede prima di risolvere la disallineanza tra le due
 * famiglie di eventi, fuori dallo scope di questo task (solo cablaggio).
 */
@Injectable()
export class FIRConsegnatoHandler implements IDomainEventHandler {
  constructor(
    private readonly rentriSyncQueue: RENTRISyncQueue,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('FIRConsegnatoHandler')
  }

  /**
   * Handle FIR Consegnato event
   */
  async handle(event: IDomainEvent): Promise<void> {
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
