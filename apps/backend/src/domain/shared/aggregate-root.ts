import { DomainEvent } from './domain-event.interface'

export abstract class AggregateRoot {
  private _domainEvents: DomainEvent[] = []

  get domainEvents(): DomainEvent[] {
    return this._domainEvents
  }

  public getDomainEvents(): DomainEvent[] {
    return this._domainEvents
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event)
  }

  public clearDomainEvents(): void {
    this._domainEvents = []
  }
}
