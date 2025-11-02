import { DomainException } from '../shared/domain-exception';

/**
 * RENTRI Sync Log Aggregate Root
 *
 * Tracks detailed sync history for audit and debugging.
 * Immutable record of each sync attempt.
 */
export class RENTRISyncLog {
  constructor(
    public readonly id: string,
    public readonly firId: string,
    public readonly tenantId: string,
    public readonly status: 'SUCCESS' | 'FAILURE' | 'PENDING',
    public readonly attempt: number,
    public readonly requestPayload: string, // JSON xFIR format
    public readonly responsePayload: string | null,
    public readonly errorMessage: string | null,
    public readonly errorCode: string | null,
    public readonly protocolNumber: string | null,
    public readonly syncedAt: Date | null,
    public readonly durationMs: number | null,
    public readonly createdAt: Date,
  ) {
    this.validate();
  }

  /**
   * Create new sync log for pending attempt
   */
  static createPending(params: {
    id: string;
    firId: string;
    tenantId: string;
    attempt: number;
    requestPayload: string;
  }): RENTRISyncLog {
    return new RENTRISyncLog(
      params.id,
      params.firId,
      params.tenantId,
      'PENDING',
      params.attempt,
      params.requestPayload,
      null,
      null,
      null,
      null,
      null,
      null,
      new Date(),
    );
  }

  /**
   * Mark sync as successful
   */
  markAsSuccess(params: {
    responsePayload: string;
    protocolNumber: string;
    durationMs: number;
  }): RENTRISyncLog {
    if (this.status !== 'PENDING') {
      throw DomainException.invalidState('RENTRISyncLog', this.status, 'Can only mark pending logs as success');
    }

    return new RENTRISyncLog(
      this.id,
      this.firId,
      this.tenantId,
      'SUCCESS',
      this.attempt,
      this.requestPayload,
      params.responsePayload,
      null,
      null,
      params.protocolNumber,
      new Date(),
      params.durationMs,
      this.createdAt,
    );
  }

  /**
   * Mark sync as failed
   */
  markAsFailure(params: {
    responsePayload?: string;
    errorMessage: string;
    errorCode?: string;
    durationMs: number;
  }): RENTRISyncLog {
    if (this.status !== 'PENDING') {
      throw DomainException.invalidState('RENTRISyncLog', this.status, 'Can only mark pending logs as failure');
    }

    return new RENTRISyncLog(
      this.id,
      this.firId,
      this.tenantId,
      'FAILURE',
      this.attempt,
      this.requestPayload,
      params.responsePayload || null,
      params.errorMessage,
      params.errorCode || null,
      null,
      null,
      params.durationMs,
      this.createdAt,
    );
  }

  /**
   * Validate invariants
   */
  private validate(): void {
    if (!this.id || !this.firId || !this.tenantId) {
      throw new DomainException('RENTRISyncLog requires id, firId, and tenantId');
    }

    if (this.attempt < 1) {
      throw new DomainException('Attempt must be positive');
    }

    if (!this.requestPayload) {
      throw new DomainException('Request payload is required');
    }

    if (this.status === 'SUCCESS') {
      if (!this.protocolNumber) {
        throw new DomainException('Success status requires protocol number');
      }
      if (!this.syncedAt) {
        throw new DomainException('Success status requires syncedAt timestamp');
      }
    }

    if (this.status === 'FAILURE') {
      if (!this.errorMessage) {
        throw new DomainException('Failure status requires error message');
      }
    }
  }

  /**
   * Check if this was a successful sync
   */
  isSuccessful(): boolean {
    return this.status === 'SUCCESS';
  }

  /**
   * Check if this was a failed sync
   */
  isFailed(): boolean {
    return this.status === 'FAILURE';
  }

  /**
   * Get summary for logging
   */
  getSummary(): string {
    if (this.isSuccessful()) {
      return `Sync successful - Protocol: ${this.protocolNumber}, Duration: ${this.durationMs}ms`;
    } else if (this.isFailed()) {
      return `Sync failed - Error: ${this.errorMessage}, Attempt: ${this.attempt}`;
    } else {
      return `Sync pending - Attempt: ${this.attempt}`;
    }
  }
}
