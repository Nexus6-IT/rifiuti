import { RENTRISyncStatus } from './rentri-sync-status.vo';

/**
 * Unit tests for RENTRISyncStatus Value Object
 *
 * Tests retry logic, backoff calculation, and state transitions.
 */
describe('RENTRISyncStatus', () => {
  describe('Construction', () => {
    it('should create status with default values', () => {
      const status = RENTRISyncStatus.pending();

      expect(status.getStatus()).toBe('PENDING');
      expect(status.getAttempts()).toBe(0);
      expect(status.canRetry()).toBe(true);
    });

    it('should create syncing status', () => {
      const status = RENTRISyncStatus.syncing();

      expect(status.getStatus()).toBe('SYNCING');
      expect(status.getAttempts()).toBe(0);
    });

    it('should create synced status with protocol number', () => {
      const protocolNumber = 'RENTRI-2025-123456';
      const status = RENTRISyncStatus.synced(protocolNumber);

      expect(status.getStatus()).toBe('SYNCED');
      expect(status.getProtocolNumber()).toBe(protocolNumber);
    });

    it('should create failed status with error', () => {
      const error = 'RENTRI service unavailable';
      const status = RENTRISyncStatus.failed(1, error);

      expect(status.getStatus()).toBe('FAILED');
      expect(status.getAttempts()).toBe(1);
      expect(status.getLastError()).toBe(error);
    });
  });

  describe('Retry Logic', () => {
    it('should allow retry when attempts < max attempts', () => {
      const status = RENTRISyncStatus.failed(1, 'Temporary error');

      expect(status.canRetry()).toBe(true);
    });

    it('should not allow retry when max attempts reached', () => {
      const status = RENTRISyncStatus.failed(5, 'Max retries reached');

      expect(status.canRetry()).toBe(false);
      expect(status.getStatus()).toBe('PERMANENTLY_FAILED');
    });

    it('should calculate exponential backoff correctly', () => {
      const status1 = RENTRISyncStatus.failed(1, 'Error 1');
      const status2 = RENTRISyncStatus.failed(2, 'Error 2');
      const status3 = RENTRISyncStatus.failed(3, 'Error 3');

      // Backoff: 2^attempt * 60 seconds
      expect(status1.getNextRetryDelay()).toBe(2 * 60); // 2 minutes
      expect(status2.getNextRetryDelay()).toBe(4 * 60); // 4 minutes
      expect(status3.getNextRetryDelay()).toBe(8 * 60); // 8 minutes
    });

    it('should calculate next retry time', () => {
      const now = new Date();
      const status = RENTRISyncStatus.failed(1, 'Error');

      const nextRetry = status.getNextRetryAt();

      expect(nextRetry).toBeInstanceOf(Date);
      expect(nextRetry.getTime()).toBeGreaterThan(now.getTime());
      expect(nextRetry.getTime()).toBeLessThanOrEqual(now.getTime() + 3 * 60 * 1000); // ~2 minutes + buffer
    });
  });

  describe('State Transitions', () => {
    it('should transition from PENDING to SYNCING', () => {
      const status = RENTRISyncStatus.pending().markAsSyncing();

      expect(status.getStatus()).toBe('SYNCING');
    });

    it('should transition from SYNCING to SYNCED', () => {
      const protocolNumber = 'RENTRI-2025-123456';
      const status = RENTRISyncStatus.syncing().markAsSynced(protocolNumber);

      expect(status.getStatus()).toBe('SYNCED');
      expect(status.getProtocolNumber()).toBe(protocolNumber);
    });

    it('should transition from SYNCING to FAILED with retry', () => {
      const error = 'Connection timeout';
      const status = RENTRISyncStatus.syncing().markAsFailed(error);

      expect(status.getStatus()).toBe('FAILED');
      expect(status.getAttempts()).toBe(1);
      expect(status.getLastError()).toBe(error);
      expect(status.canRetry()).toBe(true);
    });

    it('should not allow transition from SYNCED to FAILED', () => {
      const status = RENTRISyncStatus.synced('RENTRI-123');

      expect(() => status.markAsFailed('Error')).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty protocol number', () => {
      expect(() => RENTRISyncStatus.synced('')).toThrow();
    });

    it('should handle empty error message', () => {
      expect(() => RENTRISyncStatus.failed(1, '')).toThrow();
    });

    it('should handle negative attempts', () => {
      expect(() => RENTRISyncStatus.failed(-1, 'Error')).toThrow();
    });

    it('should cap backoff delay at maximum', () => {
      const status = RENTRISyncStatus.failed(10, 'Error'); // Very high attempts

      // Maximum backoff should be capped (e.g., 60 minutes)
      expect(status.getNextRetryDelay()).toBeLessThanOrEqual(60 * 60);
    });
  });

  describe('Value Object Equality', () => {
    it('should be equal if same status and attempts', () => {
      const status1 = RENTRISyncStatus.failed(2, 'Error');
      const status2 = RENTRISyncStatus.failed(2, 'Error');

      expect(status1.equals(status2)).toBe(true);
    });

    it('should not be equal if different status', () => {
      const status1 = RENTRISyncStatus.pending();
      const status2 = RENTRISyncStatus.syncing();

      expect(status1.equals(status2)).toBe(false);
    });

    it('should not be equal if different attempts', () => {
      const status1 = RENTRISyncStatus.failed(1, 'Error');
      const status2 = RENTRISyncStatus.failed(2, 'Error');

      expect(status1.equals(status2)).toBe(false);
    });
  });
});
