import { DomainEvent } from '../../shared/domain-event.interface';

/**
 * FIR Synced to RENTRI Event
 *
 * Emitted when a FIR is successfully synced to the RENTRI government registry.
 * Triggers notifications and audit logging.
 */
export class FIRSyncedToRENTRIEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string; // FIR ID
    tenantId: string;
    userId?: string;
    correlationId?: string;
    protocolNumber: string;
    attempts: number;
    syncedAt?: Date;
  }) {
    if (!params.protocolNumber || params.protocolNumber.trim() === '') {
      throw new Error('Protocol number is required');
    }
    if (params.attempts <= 0) {
      throw new Error('Attempts must be positive');
    }

    super({
      aggregateId: params.aggregateId,
      eventType: 'FIRSyncedToRENTRI',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        protocolNumber: params.protocolNumber,
        attempts: params.attempts,
        syncedAt: params.syncedAt || new Date(),
      },
    });
  }
}

/**
 * FIR Sync Failed Event
 *
 * Emitted when a FIR sync attempt fails.
 * Includes error details and retry information.
 */
export class FIRSyncFailedEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string; // FIR ID
    tenantId: string;
    userId?: string;
    correlationId?: string;
    error: string;
    errorCode?: string;
    attempts: number;
    willRetry: boolean;
    nextRetryAt?: Date;
  }) {
    if (!params.error || params.error.trim() === '') {
      throw new Error('Error message is required');
    }
    if (params.attempts <= 0) {
      throw new Error('Attempts must be positive');
    }

    super({
      aggregateId: params.aggregateId,
      eventType: 'FIRSyncFailed',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        error: params.error,
        errorCode: params.errorCode,
        attempts: params.attempts,
        willRetry: params.willRetry,
        nextRetryAt: params.nextRetryAt,
      },
    });
  }
}
