import { PermissionAuditLog } from '../../../../../apps/backend/src/domain/identity-access/permission-audit-log.entity';

/**
 * Unit tests for PermissionAuditLog entity
 * Tests cryptographic chaining and immutability
 * T133: PermissionAuditLog entity tests per User Story 4
 *
 * Purpose: Ensure audit logs are tamper-proof with SHA-256 cryptographic chaining
 *
 * Requirements from plan.md:
 * - Cryptographic chaining using SHA-256 for tamper detection
 * - Each log entry contains hash of previous entry
 * - Immutable once created (no updates allowed)
 * - Chain validation can detect any tampering
 * - Performance: <1ms overhead for logging per plan.md
 *
 * Requirements from spec.md FR-018:
 * - Log all permission checks (granted AND denied)
 * - Include user ID, action attempted, timestamp (millisecond precision)
 * - Include SPID fiscal code for ARPA compliance
 * - Include tenant context for multi-tenant isolation
 * - Include decision (ALLOW/DENY) and reason if denied
 */
describe('PermissionAuditLog Entity', () => {
  // Mock data
  const mockUserId = 'user-123';
  const mockTenantId = 'tenant-456';
  const mockAction = 'fir:delete:facility';
  const mockResourceType = 'fir';
  const mockResourceId = 'fir-789';
  const mockDecision = 'DENY';
  const mockReason = 'User lacks required permission: fir:delete:facility';
  const mockSpidFiscalCode = 'RSSMRA80A01H501U';
  const mockSessionId = 'session-abc';
  const mockIpAddress = '192.168.1.100';
  const mockUserAgent = 'Mozilla/5.0';
  const mockPreviousHash = '0000000000000000000000000000000000000000000000000000000000000000';

  describe('Factory method: create', () => {
    it('should create permission audit log with all required fields', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        resourceType: mockResourceType,
        resourceId: mockResourceId,
        decision: mockDecision,
        reason: mockReason,
        spidFiscalCode: mockSpidFiscalCode,
        sessionId: mockSessionId,
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
        previousHash: mockPreviousHash,
      });

      expect(log).toBeDefined();
      expect(log.userId).toBe(mockUserId);
      expect(log.tenantId).toBe(mockTenantId);
      expect(log.actionAttempted).toBe(mockAction);
      expect(log.decision).toBe(mockDecision);
      expect(log.spidFiscalCode).toBe(mockSpidFiscalCode);
    });

    it('should auto-generate ID if not provided', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      expect(log.id).toBeDefined();
      expect(typeof log.id).toBe('string');
      expect(log.id.length).toBeGreaterThan(0);
    });

    it('should auto-generate timestamp if not provided', () => {
      const beforeCreate = Date.now();

      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const afterCreate = Date.now();

      expect(log.timestamp).toBeDefined();
      expect(log.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCreate);
      expect(log.timestamp.getTime()).toBeLessThanOrEqual(afterCreate);
    });

    it('should throw error if userId is missing', () => {
      expect(() => {
        PermissionAuditLog.create({
          userId: '',
          tenantId: mockTenantId,
          actionAttempted: mockAction,
          decision: 'ALLOW',
          previousHash: mockPreviousHash,
        });
      }).toThrow('userId is required');
    });

    it('should throw error if tenantId is missing', () => {
      expect(() => {
        PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: '',
          actionAttempted: mockAction,
          decision: 'ALLOW',
          previousHash: mockPreviousHash,
        });
      }).toThrow('tenantId is required');
    });

    it('should throw error if actionAttempted is missing', () => {
      expect(() => {
        PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: '',
          decision: 'ALLOW',
          previousHash: mockPreviousHash,
        });
      }).toThrow('actionAttempted is required');
    });

    it('should throw error if decision is invalid', () => {
      expect(() => {
        PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: mockAction,
          decision: 'INVALID',
          previousHash: mockPreviousHash,
        });
      }).toThrow('decision must be ALLOW or DENY');
    });

    it('should require reason when decision is DENY', () => {
      expect(() => {
        PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: mockAction,
          decision: 'DENY',
          reason: '',
          previousHash: mockPreviousHash,
        });
      }).toThrow('reason is required when decision is DENY');
    });

    it('should allow missing reason when decision is ALLOW', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      expect(log.reason).toBeUndefined();
    });
  });

  describe('Cryptographic chaining with SHA-256', () => {
    it('should calculate hash of log entry', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const hash = log.calculateHash();

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 produces 64-character hex string
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true); // Valid hex string
    });

    it('should produce different hashes for different log entries', () => {
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:delete:facility',
        decision: 'DENY',
        previousHash: mockPreviousHash,
      });

      expect(log1.calculateHash()).not.toBe(log2.calculateHash());
    });

    it('should produce same hash for identical log entries', () => {
      const timestamp = new Date();

      const log1 = PermissionAuditLog.create({
        id: 'test-id-123',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        timestamp,
        previousHash: mockPreviousHash,
      });

      const log2 = PermissionAuditLog.create({
        id: 'test-id-123',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        timestamp,
        previousHash: mockPreviousHash,
      });

      expect(log1.calculateHash()).toBe(log2.calculateHash());
    });

    it('should include previousHash in current hash calculation', () => {
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      });

      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: '1111111111111111111111111111111111111111111111111111111111111111',
      });

      // Hashes should be different because previousHash is different
      expect(log1.calculateHash()).not.toBe(log2.calculateHash());
    });

    it('should store hash after calculation', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const hash = log.calculateHash();

      expect(log.hash).toBe(hash);
    });
  });

  describe('Chain validation', () => {
    it('should validate that current hash matches expected hash', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const hash = log.calculateHash();

      // Simulate loading from database with stored hash
      const loadedLog = PermissionAuditLog.fromPersistence({
        ...log,
        hash,
      });

      expect(loadedLog.isHashValid()).toBe(true);
    });

    it('should detect tampering if hash does not match', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      // Store original hash
      const originalHash = log.calculateHash();

      // Simulate tampering: modify data after hash calculation
      const tamperedLog = PermissionAuditLog.fromPersistence({
        ...log,
        hash: originalHash,
        actionAttempted: 'fir:delete:all', // Changed!
      });

      expect(tamperedLog.isHashValid()).toBe(false);
    });

    it('should validate chain between consecutive logs', () => {
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const hash1 = log1.calculateHash();

      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:read:facility',
        decision: 'ALLOW',
        previousHash: hash1, // Links to previous log
      });

      expect(log2.previousHash).toBe(hash1);
      expect(log2.isChainValid(log1)).toBe(true);
    });

    it('should detect broken chain between logs', () => {
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const hash1 = log1.calculateHash();

      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:read:facility',
        decision: 'ALLOW',
        previousHash: 'wrong-hash-value',
      });

      expect(log2.isChainValid(log1)).toBe(false);
    });
  });

  describe('Immutability', () => {
    it('should not allow modification of log entry after creation', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      // Attempt to modify should fail or have no effect
      expect(() => {
        (log as any).decision = 'DENY';
      }).toThrow(); // Assuming entity uses Object.freeze() or similar
    });

    it('should not provide update methods', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      expect((log as any).update).toBeUndefined();
      expect((log as any).setDecision).toBeUndefined();
      expect((log as any).modify).toBeUndefined();
    });
  });

  describe('Performance requirements', () => {
    it('should create log entry in <1ms per plan.md', () => {
      const startTime = performance.now();

      PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1);
    });

    it('should calculate hash in <1ms per plan.md', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        previousHash: mockPreviousHash,
      });

      const startTime = performance.now();
      log.calculateHash();
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1);
    });
  });

  describe('Serialization for persistence', () => {
    it('should convert to plain object for persistence', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        resourceType: mockResourceType,
        resourceId: mockResourceId,
        decision: mockDecision,
        reason: mockReason,
        spidFiscalCode: mockSpidFiscalCode,
        sessionId: mockSessionId,
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
        previousHash: mockPreviousHash,
      });

      const hash = log.calculateHash();
      const plainObject = log.toPersistence();

      expect(plainObject).toEqual({
        id: log.id,
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        resourceType: mockResourceType,
        resourceId: mockResourceId,
        decision: mockDecision,
        reason: mockReason,
        spidFiscalCode: mockSpidFiscalCode,
        sessionId: mockSessionId,
        ipAddress: mockIpAddress,
        userAgent: mockUserAgent,
        timestamp: log.timestamp,
        previousHash: mockPreviousHash,
        hash,
      });
    });

    it('should reconstruct from persistence', () => {
      const timestamp = new Date();
      const id = 'test-id-123';
      const hash = 'test-hash-456';

      const persistedData = {
        id,
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: mockAction,
        decision: 'ALLOW',
        timestamp,
        previousHash: mockPreviousHash,
        hash,
      };

      const log = PermissionAuditLog.fromPersistence(persistedData);

      expect(log.id).toBe(id);
      expect(log.userId).toBe(mockUserId);
      expect(log.timestamp).toEqual(timestamp);
      expect(log.hash).toBe(hash);
    });
  });
});
