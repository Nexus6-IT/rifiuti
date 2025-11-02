/**
 * Base Aggregate Root - DDD Pattern
 * Gestisce domain events per Event-Driven Architecture
 */

export interface DomainEvent {
  occurredOn: Date
  eventName: string
}

export abstract class AggregateRoot {
  private _domainEvents: DomainEvent[] = []

  get domainEvents(): DomainEvent[] {
    return this._domainEvents
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event)
  }

  public clearDomainEvents(): void {
    this._domainEvents = []
  }
}
