import { Injectable } from '@nestjs/common';
import { IDomainEvent, IDomainEventHandler } from '../domain/shared/domain-event.interface';
import { LoggerService } from './logger/logger.service';

/**
 * DomainEvents Service
 *
 * Centralized service for publishing and handling domain events.
 * Implements in-memory event bus with async handlers.
 *
 * Usage:
 * ```typescript
 * // Publish event
 * await domainEvents.publish(new FIRCreatedEvent(...));
 *
 * // Register handler
 * domainEvents.register('FIRCreated', firCreatedHandler);
 * ```
 *
 * Benefits:
 * - Decouples domain logic from infrastructure
 * - Enables async side effects (notifications, sync jobs, etc.)
 * - Provides audit trail through events
 */
@Injectable()
export class DomainEventsService {
  private handlers: Map<string, IDomainEventHandler[]> = new Map();

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('DomainEventsService');
  }

  /**
   * Register a handler for specific event type
   */
  register(eventType: string, handler: IDomainEventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
    this.logger.debug(`Registered handler for event: ${eventType}`, {
      handlerCount: this.handlers.get(eventType)!.length,
    });
  }

  /**
   * Publish a domain event to all registered handlers
   */
  async publish(event: IDomainEvent): Promise<void> {
    this.logger.info(`Publishing domain event: ${event.eventType}`, {
      eventId: event.eventId,
      aggregateId: event.aggregateId,
      tenantId: event.tenantId,
      correlationId: event.correlationId,
    });

    const handlers = this.handlers.get(event.eventType) || [];

    if (handlers.length === 0) {
      this.logger.warn(`No handlers registered for event: ${event.eventType}`, {
        eventId: event.eventId,
      });
      return;
    }

    // Execute all handlers in parallel
    const results = await Promise.allSettled(
      handlers.map(async (handler) => {
        try {
          await handler.handle(event);
          this.logger.debug(`Handler executed successfully for: ${event.eventType}`, {
            eventId: event.eventId,
          });
        } catch (error) {
          this.logger.error(`Handler failed for event: ${event.eventType}`, error as Error, {
            eventId: event.eventId,
            aggregateId: event.aggregateId,
          });
          throw error;
        }
      }),
    );

    // Check if any handler failed
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      this.logger.error(`${failures.length} handlers failed for: ${event.eventType}`, undefined, {
        eventId: event.eventId,
        failureCount: failures.length,
        totalHandlers: handlers.length,
      });
    }
  }

  /**
   * Publish multiple events in sequence
   */
  async publishAll(events: IDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  /**
   * Clear all registered handlers (useful for testing)
   */
  clearHandlers(): void {
    this.handlers.clear();
    this.logger.debug('All domain event handlers cleared');
  }

  /**
   * Get count of handlers for specific event type
   */
  getHandlerCount(eventType: string): number {
    return (this.handlers.get(eventType) || []).length;
  }

  /**
   * Get all registered event types
   */
  getRegisteredEventTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
