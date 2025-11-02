import { Test, TestingModule } from '@nestjs/testing';
import { GetAuditTrailQueryHandler } from '../../../../../apps/backend/src/application/queries/handlers/get-audit-trail.handler';
import { GetAuditTrailQuery } from '../../../../../apps/backend/src/application/queries/get-audit-trail.query';
import { PermissionAuditLogRepository } from '../../../../../apps/backend/src/domain/identity-access/permission-audit-log.repository.interface';

/**
 * Unit tests for GetAuditTrailQueryHandler
 * Tests audit trail retrieval with filtering and pagination
 * T135: GetAuditTrailQuery handler tests per User Story 4
 *
 * Purpose: Query permission audit logs with filters for compliance reviews
 *
 * Requirements from spec.md acceptance scenario 2:
 * - Filter by user, date range, decision (ALLOW/DENY), resource type
 * - Paginate results for large datasets
 * - Return audit logs in chronological order (newest first)
 * - Include all required audit fields (user, action, timestamp, decision)
 *
 * Requirements from plan.md:
 * - <500ms P95 latency for audit queries with indexed lookups
 * - Support up to 1M audit logs per tenant
 * - Monthly table partitioning for efficient queries
 */
describe('GetAuditTrailQueryHandler', () => {
  let handler: GetAuditTrailQueryHandler;
  let mockRepository: jest.Mocked<PermissionAuditLogRepository>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';

  beforeEach(async () => {
    // Mock repository
    mockRepository = {
      findByTenant: jest.fn(),
      findByUser: jest.fn(),
      findByResource: jest.fn(),
      findByDateRange: jest.fn(),
      findByDecision: jest.fn(),
      findWithFilters: jest.fn(),
      count: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetAuditTrailQueryHandler,
        {
          provide: 'PermissionAuditLogRepository',
          useValue: mockRepository,
        },
      ],
    }).compile();

    handler = module.get<GetAuditTrailQueryHandler>(GetAuditTrailQueryHandler);
  });

  describe('Basic query execution', () => {
    it('should retrieve audit logs for tenant', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: 'fir:create:facility',
          decision: 'ALLOW',
          timestamp: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: 'log-2',
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: 'fir:delete:facility',
          decision: 'DENY',
          timestamp: new Date('2024-01-15T09:00:00Z'),
        },
      ];

      mockRepository.findWithFilters.mockResolvedValue({
        logs: mockLogs,
        total: 2,
        page: 1,
        pageSize: 50,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        page: 1,
        pageSize: 50,
      });

      const result = await handler.execute(query);

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        page: 1,
        pageSize: 50,
      });
    });

    it('should return empty array if no logs found', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
        page: 1,
        pageSize: 50,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
      });

      const result = await handler.execute(query);

      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('Filtering', () => {
    it('should filter by user ID', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: 'fir:create:facility',
          decision: 'ALLOW',
        },
      ];

      mockRepository.findWithFilters.mockResolvedValue({
        logs: mockLogs,
        total: 1,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        userId: mockUserId,
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        userId: mockUserId,
      });
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        startDate,
        endDate,
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        startDate,
        endDate,
      });
    });

    it('should filter by decision (ALLOW)', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        decision: 'ALLOW',
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        decision: 'ALLOW',
      });
    });

    it('should filter by decision (DENY)', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        decision: 'DENY',
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        decision: 'DENY',
      });
    });

    it('should filter by resource type', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        resourceType: 'fir',
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        resourceType: 'fir',
      });
    });

    it('should filter by resource ID', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        resourceType: 'fir',
        resourceId: 'fir-789',
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        resourceType: 'fir',
        resourceId: 'fir-789',
      });
    });

    it('should apply multiple filters simultaneously', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        userId: mockUserId,
        decision: 'DENY',
        resourceType: 'fir',
        startDate,
        endDate,
      });

      await handler.execute(query);

      expect(mockRepository.findWithFilters).toHaveBeenCalledWith({
        tenantId: mockTenantId,
        userId: mockUserId,
        decision: 'DENY',
        resourceType: 'fir',
        startDate,
        endDate,
      });
    });
  });

  describe('Pagination', () => {
    it('should paginate results with default page size', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: new Array(50).fill({ id: 'log' }),
        total: 150,
        page: 1,
        pageSize: 50,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
      });

      const result = await handler.execute(query);

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
      expect(result.total).toBe(150);
      expect(result.totalPages).toBe(3);
    });

    it('should support custom page size', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: new Array(100).fill({ id: 'log' }),
        total: 500,
        page: 1,
        pageSize: 100,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        pageSize: 100,
      });

      const result = await handler.execute(query);

      expect(result.pageSize).toBe(100);
      expect(result.totalPages).toBe(5);
    });

    it('should support navigating to specific page', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 150,
        page: 3,
        pageSize: 50,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        page: 3,
        pageSize: 50,
      });

      const result = await handler.execute(query);

      expect(result.page).toBe(3);
    });

    it('should limit maximum page size to 100', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
        page: 1,
        pageSize: 100,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        pageSize: 500, // Request too large
      });

      await handler.execute(query);

      // Should be capped at 100
      expect(mockRepository.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          pageSize: 100,
        }),
      );
    });
  });

  describe('Sorting', () => {
    it('should return logs in chronological order (newest first)', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          timestamp: new Date('2024-01-15T12:00:00Z'),
        },
        {
          id: 'log-2',
          timestamp: new Date('2024-01-15T11:00:00Z'),
        },
        {
          id: 'log-3',
          timestamp: new Date('2024-01-15T10:00:00Z'),
        },
      ];

      mockRepository.findWithFilters.mockResolvedValue({
        logs: mockLogs,
        total: 3,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
      });

      const result = await handler.execute(query);

      expect(result.logs[0].timestamp.getTime()).toBeGreaterThan(
        result.logs[1].timestamp.getTime(),
      );
      expect(result.logs[1].timestamp.getTime()).toBeGreaterThan(
        result.logs[2].timestamp.getTime(),
      );
    });
  });

  describe('Performance requirements', () => {
    it('should execute query in <500ms per plan.md P95', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: new Array(50).fill({ id: 'log' }),
        total: 50,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
      });

      const startTime = performance.now();
      await handler.execute(query);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(500);
    });

    it('should use indexed queries for filtering', async () => {
      mockRepository.findWithFilters.mockResolvedValue({
        logs: [],
        total: 0,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        userId: mockUserId,
      });

      await handler.execute(query);

      // Verify indexed fields are used in query
      expect(mockRepository.findWithFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId, // Indexed
          userId: mockUserId, // Indexed
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('should throw error if tenantId is missing', async () => {
      const query = new GetAuditTrailQuery({
        tenantId: '',
      });

      await expect(handler.execute(query)).rejects.toThrow(
        'tenantId is required',
      );
    });

    it('should handle repository errors gracefully', async () => {
      mockRepository.findWithFilters.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
      });

      await expect(handler.execute(query)).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should validate date range (endDate after startDate)', async () => {
      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
        startDate: new Date('2024-01-31'),
        endDate: new Date('2024-01-01'), // Before start date
      });

      await expect(handler.execute(query)).rejects.toThrow(
        'endDate must be after startDate',
      );
    });
  });

  describe('Audit trail completeness', () => {
    it('should include all required audit fields in response', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: 'fir:delete:facility',
          resourceType: 'fir',
          resourceId: 'fir-789',
          decision: 'DENY',
          reason: 'Insufficient permissions',
          timestamp: new Date('2024-01-15T10:00:00Z'),
          spidFiscalCode: 'RSSMRA80A01H501U',
          sessionId: 'session-abc',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
        },
      ];

      mockRepository.findWithFilters.mockResolvedValue({
        logs: mockLogs,
        total: 1,
      });

      const query = new GetAuditTrailQuery({
        tenantId: mockTenantId,
      });

      const result = await handler.execute(query);

      const log = result.logs[0];

      // Verify all required fields per spec.md FR-018
      expect(log.userId).toBeDefined();
      expect(log.actionAttempted).toBeDefined();
      expect(log.timestamp).toBeDefined();
      expect(log.decision).toBeDefined();
      expect(log.spidFiscalCode).toBeDefined();
      expect(log.sessionId).toBeDefined();
      expect(log.ipAddress).toBeDefined();
    });
  });
});
