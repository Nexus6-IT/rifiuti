import { DomainEvent } from '../../shared/domain-event.interface'

/**
 * User Created Domain Event
 *
 * Emitted when a new user is created in the system.
 * Used for:
 * - Audit logging
 * - Welcome email notifications
 * - Analytics tracking
 * - Tenant user count updates
 *
 * Event subscribers can use this to trigger downstream actions
 * without coupling the User aggregate to those concerns.
 */
export class UserCreatedEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string
    userId: string
    fiscalCode: string
    email: string
    tenantId: string
    hasSpidAuth: boolean
    correlationId?: string
  }) {
    super({
      aggregateId: params.aggregateId,
      eventType: 'USER_CREATED',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        userId: params.userId,
        fiscalCode: params.fiscalCode,
        email: params.email,
        tenantId: params.tenantId,
        hasSpidAuth: params.hasSpidAuth,
      },
    })
  }
}

/**
 * User SPID Authentication Updated Event
 *
 * Emitted when user re-authenticates with SPID
 * (e.g., to upgrade to Level 2/3 or refresh session)
 */
export class UserSpidAuthUpdatedEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string
    userId: string
    fiscalCode: string
    spidLevel: number
    issuer: string
    sessionId: string
    canSignDocuments: boolean
    tenantId: string
    correlationId?: string
  }) {
    super({
      aggregateId: params.aggregateId,
      eventType: 'USER_SPID_AUTH_UPDATED',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        userId: params.userId,
        fiscalCode: params.fiscalCode,
        spidLevel: params.spidLevel,
        issuer: params.issuer,
        sessionId: params.sessionId,
        canSignDocuments: params.canSignDocuments,
      },
    })
  }
}

/**
 * User Logged Out Event
 *
 * Emitted when user logs out (clears SPID authentication)
 */
export class UserLoggedOutEvent extends DomainEvent {
  constructor(params: {
    aggregateId: string
    userId: string
    fiscalCode: string
    tenantId: string
    correlationId?: string
  }) {
    super({
      aggregateId: params.aggregateId,
      eventType: 'USER_LOGGED_OUT',
      tenantId: params.tenantId,
      userId: params.userId,
      correlationId: params.correlationId,
      payload: {
        userId: params.userId,
        fiscalCode: params.fiscalCode,
        tenantId: params.tenantId,
      },
    })
  }
}
