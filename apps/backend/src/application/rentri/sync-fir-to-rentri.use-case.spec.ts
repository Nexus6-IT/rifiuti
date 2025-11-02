import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case';

/**
 * Unit tests for SyncFIRToRENTRI Use Case
 *
 * Tests the application logic for synchronizing a single FIR to RENTRI.
 * Uses mocks for dependencies (repository, API client, event bus).
 */
describe('SyncFIRToRENTRIUseCase', () => {
  let useCase: SyncFIRToRENTRIUseCase;
  let mockFIRRepository: any;
  let mockRENTRIApiClient: any;
  let mockSyncLogRepository: any;
  let mockDomainEvents: any;
  let mockLogger: any;

  beforeEach(() => {
    // Create mocks
    mockFIRRepository = {
      findById: jest.fn(),
      update: jest.fn(),
    };

    mockRENTRIApiClient = {
      submitFIR: jest.fn(),
      validateFIR: jest.fn(),
    };

    mockSyncLogRepository = {
      createPending: jest.fn(),
      save: jest.fn(),
    };

    mockDomainEvents = {
      publish: jest.fn(),
    };

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    // Directly instantiate the use case with mocks
    useCase = new SyncFIRToRENTRIUseCase(
      mockFIRRepository,
      mockRENTRIApiClient,
      mockSyncLogRepository,
      mockDomainEvents,
      mockLogger,
    );
  });

  describe('Successful Sync', () => {
    it('should sync FIR to RENTRI successfully', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-001',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISynced: jest.fn(),
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncedToRENTRI', aggregateId: firId },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'SUCCESS',
        }),
      };

      const protocolNumber = 'RENTRI-2025-123456';

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockResolvedValue({
        success: true,
        protocolNumber,
      });
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      const result = await useCase.execute(firId, tenantId);

      expect(result.success).toBe(true);
      expect(result.protocolNumber).toBe(protocolNumber);
      expect(mockFIRRepository.findById).toHaveBeenCalledWith(firId);
      expect(mockFIR.canSyncToRENTRI).toHaveBeenCalled();
      expect(mockFIR.startRENTRISync).toHaveBeenCalled();
      expect(mockRENTRIApiClient.submitFIR).toHaveBeenCalledWith(mockFIR);
      expect(mockFIR.markRENTRISynced).toHaveBeenCalledWith(protocolNumber, undefined);
      expect(mockFIRRepository.update).toHaveBeenCalledWith(firId, mockFIR);
      expect(mockSyncLogRepository.save).toHaveBeenCalled();
      expect(mockDomainEvents.publish).toHaveBeenCalled();
    });

    it('should handle sync after retries', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-002',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('FAILED'),
          getAttempts: jest.fn().mockReturnValue(2), // Previous failures
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISynced: jest.fn(),
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncedToRENTRI', aggregateId: firId },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'SUCCESS',
        }),
      };

      const protocolNumber = 'RENTRI-2025-789';

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockResolvedValue({
        success: true,
        protocolNumber,
      });
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      const result = await useCase.execute(firId, tenantId);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2); // Current attempts value
    });
  });

  describe('Validation Errors', () => {
    it('should throw if FIR not found', async () => {
      const firId = 'nonexistent-fir';
      const tenantId = 'tenant-456';

      mockFIRRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow('FIR');
    });

    it('should throw if FIR belongs to different tenant', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId: 'different-tenant', // Different tenant
        status: 'COMPLETED',
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow('Unauthorized');
    });

    it('should throw if FIR not in completed status', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'DRAFT', // Not completed
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(false),
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow();
    });

    it('should throw if FIR already synced', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('SYNCED'),
          getProtocolNumber: jest.fn().mockReturnValue('RENTRI-EXISTING'),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(false),
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow();
    });
  });

  describe('Sync Failures', () => {
    it('should handle RENTRI API errors with retry', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-003',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncFailed', aggregateId: firId },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      };

      const apiError = new Error('RENTRI service unavailable');

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockRejectedValue(apiError);
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      const result = await useCase.execute(firId, tenantId);

      expect(result.success).toBe(false);
      expect(result.willRetry).toBe(true);
      expect(result.error).toBe('RENTRI service unavailable');
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        'RENTRI service unavailable',
        'RENTRI_API_ERROR',
        undefined,
      );
      expect(mockDomainEvents.publish).toHaveBeenCalled(); // FIRSyncFailedEvent
    });

    it('should mark as permanently failed after max retries', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-004',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('FAILED'),
          getAttempts: jest.fn().mockReturnValue(4), // One more attempt will hit max (5)
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(false), // Max retries reached
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncFailed', aggregateId: firId },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockRejectedValue(new Error('Persistent error'));
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      const result = await useCase.execute(firId, tenantId);

      expect(result.success).toBe(false);
      expect(result.willRetry).toBe(false);
      expect(result.attempts).toBe(4);
    });

    it('should handle validation errors from RENTRI', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-005',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncFailed', aggregateId: firId },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockResolvedValue({
        success: false,
        errors: [{ code: 'E001', field: 'cerCode', message: 'Invalid CER code' }],
      });
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      const result = await useCase.execute(firId, tenantId);

      expect(result.success).toBe(false);
      expect(result.willRetry).toBe(false); // Validation errors don't retry
      expect(result.error).toContain('Invalid CER code');
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid CER code'),
        'RENTRI_VALIDATION_ERROR',
        undefined,
      );
    });
  });

  describe('Event Publishing', () => {
    it('should publish FIRSyncedToRENTRIEvent on success', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-006',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISynced: jest.fn(),
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncedToRENTRI', aggregateId: firId },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'SUCCESS',
        }),
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockResolvedValue({
        success: true,
        protocolNumber: 'RENTRI-123',
      });
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      await useCase.execute(firId, tenantId);

      const publishedEvent = mockDomainEvents.publish.mock.calls[0][0];
      expect(publishedEvent.eventType).toBe('FIRSyncedToRENTRI');
      expect(publishedEvent.aggregateId).toBe(firId);
    });

    it('should publish FIRSyncFailedEvent on failure', async () => {
      const firId = 'fir-123';
      const tenantId = 'tenant-456';
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-007',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        startRENTRISync: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest.fn().mockReturnValue([
          { eventType: 'FIRSyncFailed', aggregateId: firId, payload: { willRetry: true } },
        ]),
        clearDomainEvents: jest.fn(),
      };

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      };

      mockFIRRepository.findById.mockResolvedValue(mockFIR);
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog);
      mockRENTRIApiClient.submitFIR.mockRejectedValue(new Error('API Error'));
      mockFIRRepository.update.mockResolvedValue(undefined);
      mockSyncLogRepository.save.mockResolvedValue(undefined);

      await useCase.execute(firId, tenantId);

      const publishedEvent = mockDomainEvents.publish.mock.calls[0][0];
      expect(publishedEvent.eventType).toBe('FIRSyncFailed');
      expect(publishedEvent.payload.willRetry).toBe(true);
    });
  });
});
