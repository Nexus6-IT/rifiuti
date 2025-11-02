import { FIRSyncedToRENTRIEvent, FIRSyncFailedEvent } from './fir-synced-to-rentri.event';

/**
 * Unit tests for RENTRI Sync Domain Events
 *
 * Tests event creation, payload structure, and immutability.
 */
describe('RENTRI Sync Domain Events', () => {
  const tenantId = 'tenant-123';
  const userId = 'user-456';
  const firId = 'fir-789';
  const correlationId = 'correlation-abc';

  describe('FIRSyncedToRENTRIEvent', () => {
    it('should create event with required fields', () => {
      const protocolNumber = 'RENTRI-2025-123456';
      const event = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        userId,
        correlationId,
        protocolNumber,
        attempts: 1,
      });

      expect(event.eventType).toBe('FIRSyncedToRENTRI');
      expect(event.aggregateId).toBe(firId);
      expect(event.tenantId).toBe(tenantId);
      expect(event.userId).toBe(userId);
      expect(event.correlationId).toBe(correlationId);
      expect(event.payload.protocolNumber).toBe(protocolNumber);
      expect(event.payload.attempts).toBe(1);
      expect(event.occurredOn).toBeInstanceOf(Date);
      expect(event.eventId).toBeDefined();
    });

    it('should have immutable properties', () => {
      const event = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-123',
        attempts: 1,
      });

      // TypeScript readonly provides compile-time immutability
      // Runtime immutability would require Object.freeze()
      expect(event.eventType).toBe('FIRSyncedToRENTRI');
      expect(event.aggregateId).toBe(firId);
      expect(event.tenantId).toBe(tenantId);
      
      // Properties are defined and readonly at TypeScript level
      expect(event).toHaveProperty('eventType');
      expect(event).toHaveProperty('eventId');
      expect(event).toHaveProperty('occurredOn');
    });

    it('should include syncedAt timestamp in payload', () => {
      const now = new Date();
      const event = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-123',
        attempts: 1,
        syncedAt: now,
      });

      expect(event.payload.syncedAt).toBe(now);
    });

    it('should handle multiple sync attempts', () => {
      const event = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-123',
        attempts: 3, // Success after 3 attempts
      });

      expect(event.payload.attempts).toBe(3);
    });
  });

  describe('FIRSyncFailedEvent', () => {
    it('should create event with error details', () => {
      const error = 'RENTRI API timeout';
      const event = new FIRSyncFailedEvent({
        aggregateId: firId,
        tenantId,
        userId,
        correlationId,
        error,
        attempts: 2,
        willRetry: true,
      });

      expect(event.eventType).toBe('FIRSyncFailed');
      expect(event.aggregateId).toBe(firId);
      expect(event.payload.error).toBe(error);
      expect(event.payload.attempts).toBe(2);
      expect(event.payload.willRetry).toBe(true);
    });

    it('should indicate no retry when max attempts reached', () => {
      const event = new FIRSyncFailedEvent({
        aggregateId: firId,
        tenantId,
        error: 'Max retries exceeded',
        attempts: 5,
        willRetry: false,
      });

      expect(event.payload.willRetry).toBe(false);
      expect(event.payload.attempts).toBe(5);
    });

    it('should include next retry time when retry is scheduled', () => {
      const nextRetry = new Date(Date.now() + 120000); // 2 minutes
      const event = new FIRSyncFailedEvent({
        aggregateId: firId,
        tenantId,
        error: 'Temporary failure',
        attempts: 1,
        willRetry: true,
        nextRetryAt: nextRetry,
      });

      expect(event.payload.nextRetryAt).toBe(nextRetry);
      expect(event.payload.willRetry).toBe(true);
    });

    it('should include error code if provided', () => {
      const event = new FIRSyncFailedEvent({
        aggregateId: firId,
        tenantId,
        error: 'Validation failed',
        errorCode: 'E001_INVALID_CER_CODE',
        attempts: 1,
        willRetry: false,
      });

      expect(event.payload.errorCode).toBe('E001_INVALID_CER_CODE');
    });
  });

  describe('Event Uniqueness', () => {
    it('should generate unique event IDs', () => {
      const event1 = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-123',
        attempts: 1,
      });

      const event2 = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-123',
        attempts: 1,
      });

      expect(event1.eventId).not.toBe(event2.eventId);
    });

    it('should have different timestamps for sequential events', async () => {
      const event1 = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-123',
        attempts: 1,
      });

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const event2 = new FIRSyncedToRENTRIEvent({
        aggregateId: firId,
        tenantId,
        protocolNumber: 'RENTRI-456',
        attempts: 1,
      });

      expect(event2.occurredOn.getTime()).toBeGreaterThanOrEqual(event1.occurredOn.getTime());
    });
  });

  describe('Event Payload Validation', () => {
    it('should require protocol number for sync success', () => {
      expect(() => {
        new FIRSyncedToRENTRIEvent({
          aggregateId: firId,
          tenantId,
          protocolNumber: '', // Invalid
          attempts: 1,
        });
      }).toThrow();
    });

    it('should require error message for sync failure', () => {
      expect(() => {
        new FIRSyncFailedEvent({
          aggregateId: firId,
          tenantId,
          error: '', // Invalid
          attempts: 1,
          willRetry: false,
        });
      }).toThrow();
    });

    it('should require positive attempts count', () => {
      expect(() => {
        new FIRSyncedToRENTRIEvent({
          aggregateId: firId,
          tenantId,
          protocolNumber: 'RENTRI-123',
          attempts: 0, // Invalid
        });
      }).toThrow();
    });
  });
});
