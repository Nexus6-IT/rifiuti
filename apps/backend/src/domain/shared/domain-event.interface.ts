/**
 * Base Domain Event Interface
 *
 * All domain events should implement this interface.
 * Domain events represent significant business events that have occurred.
 *
 * Examples:
 * - FIRCreatedEvent
 * - FIRSignedEvent
 * - FIRSyncedToRENTRIEvent
 * - MUDReportGeneratedEvent
 *
 * Events are:
 * - Immutable (readonly properties)
 * - Past tense (represent something that has happened)
 * - Rich in business context
 */
export interface IDomainEvent {
  /**
   * Unique event identifier
   */
  readonly eventId: string

  /**
   * Aggregate ID that triggered this event
   */
  readonly aggregateId: string

  /**
   * Event type (e.g., 'FIRCreated', 'FIRSigned')
   */
  readonly eventType: string

  /**
   * Timestamp when event occurred
   */
  readonly occurredOn: Date

  /**
   * Tenant context (for multi-tenant isolation)
   */
  readonly tenantId: string

  /**
   * User who triggered the event (if applicable)
   */
  readonly userId?: string

  /**
   * Correlation ID for request tracing
   */
  readonly correlationId?: string

  /**
   * Event-specific payload data
   */
  readonly payload: Record<string, any>
}

/**
 * Base Domain Event Class
 *
 * Provides common implementation for domain events.
 */
export abstract class DomainEvent implements IDomainEvent {
  readonly eventId: string
  readonly aggregateId: string
  readonly eventType: string
  readonly occurredOn: Date
  readonly tenantId: string
  readonly userId?: string
  readonly correlationId?: string
  readonly payload: Record<string, any>

  protected constructor(params: {
    aggregateId: string
    eventType: string
    tenantId: string
    userId?: string
    correlationId?: string
    payload: Record<string, any>
  }) {
    this.eventId = this.generateEventId()
    this.aggregateId = params.aggregateId
    this.eventType = params.eventType
    this.tenantId = params.tenantId
    this.userId = params.userId
    this.correlationId = params.correlationId
    this.payload = params.payload
    this.occurredOn = new Date()
  }

  private generateEventId(): string {
    // Simple UUID v4 generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

/**
 * Domain Event Handler Interface
 *
 * Handlers react to domain events and perform side effects.
 */
export interface IDomainEventHandler<T extends IDomainEvent = IDomainEvent> {
  /**
   * Handle a domain event
   */
  handle(event: T): Promise<void>
}
