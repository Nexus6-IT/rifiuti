import { DomainEvent } from '../../shared/domain-event.interface'
import { SignatureRole } from '../digital-signature.vo'

/**
 * FIR Signed Event
 *
 * Emitted when a signature is applied to a FIR.
 * Used for audit logging and workflow progression.
 */
export class FIRSignedEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string
    firId: string
    firNumber: string
    tenantId: string
    role: SignatureRole
    signerFiscalCode: string
    signerName: string
    signatureMethod: string
    signedAt: Date
    newStatus: string
    userId?: string
    correlationId?: string
  }) {
    super({
      aggregateId: params.aggregateId,
      eventType: 'FIR_SIGNED',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        firId: params.firId,
        firNumber: params.firNumber,
        tenantId: params.tenantId,
        role: params.role,
        signerFiscalCode: params.signerFiscalCode,
        signerName: params.signerName,
        signatureMethod: params.signatureMethod,
        signedAt: params.signedAt,
        newStatus: params.newStatus,
      },
    })
  }
}

/**
 * FIR Completed Event
 *
 * Emitted when all three signatures are applied (Producer, Carrier, Receiver).
 * Triggers RENTRI sync workflow.
 */
export class FIRCompletedEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string
    firId: string
    firNumber: string
    tenantId: string
    completedAt: Date
    signatureCount: number
    userId?: string
    correlationId?: string
  }) {
    super({
      aggregateId: params.aggregateId,
      eventType: 'FIR_COMPLETED',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        firId: params.firId,
        firNumber: params.firNumber,
        tenantId: params.tenantId,
        completedAt: params.completedAt,
        signatureCount: params.signatureCount,
      },
    })
  }
}
