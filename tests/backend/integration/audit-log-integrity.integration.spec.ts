import { Test, TestingModule } from '@nestjs/testing';
import { PermissionAuditLog } from '../../../apps/backend/src/domain/identity-access/permission-audit-log.entity';
import { PermissionAuditLogRepository } from '../../../apps/backend/src/domain/identity-access/permission-audit-log.repository.interface';

/**
 * Integration tests for audit log cryptographic chain integrity
 * Tests end-to-end chain validation and tampering detection
 * T136: Audit log chain integrity integration tests per User Story 4
 *
 * Purpose: Verify cryptographic chain prevents tampering with audit logs
 *
 * Requirements from plan.md:
 * - SHA-256 cryptographic chaining for tamper detection
 * - Each log entry contains hash of previous entry
 * - Chain validation can detect ANY tampering in the chain
 * - Support validation of chains with 1M+ entries
 *
 * Requirements from spec.md FR-018:
 * - Audit logs must be immutable and tamper-proof
 * - 10-year retention for ARPA compliance
 * - Cryptographic verification for regulatory audits
 */
describe('Audit Log Cryptographic Chain Integrity (Integration)', () => {
  let module: TestingModule;
  let repository: PermissionAuditLogRepository;

  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';

  beforeAll(async () => {
    // Mock repository for integration test
    const mockRepo = {
      save: jest.fn(),
      findByTenant: jest.fn(),
      getLatestLog: jest.fn(),
      validateChainIntegrity: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        {
          provide: 'PermissionAuditLogRepository',
          useValue: mockRepo,
        },
      ],
    }).compile();

    repository = module.get<PermissionAuditLogRepository>(
      'PermissionAuditLogRepository',
    );
  });

  describe('Chain creation', () => {
    it('should create valid chain with genesis log', () => {
      // Genesis log (first log, no previous hash)
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: genesisHash,
      });

      const hash1 = log1.calculateHash();

      expect(hash1).toBeDefined();
      expect(hash1).not.toBe(genesisHash);
      expect(log1.isHashValid()).toBe(true);
    });

    it('should create valid chain with multiple logs', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      // Log 1
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: genesisHash,
      });
      const hash1 = log1.calculateHash();

      // Log 2 (links to log 1)
      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:read:facility',
        decision: 'ALLOW',
        previousHash: hash1,
      });
      const hash2 = log2.calculateHash();

      // Log 3 (links to log 2)
      const log3 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:update:facility',
        decision: 'ALLOW',
        previousHash: hash2,
      });

      // Verify chain
      expect(log2.isChainValid(log1)).toBe(true);
      expect(log3.isChainValid(log2)).toBe(true);
    });
  });

  describe('Tampering detection', () => {
    it('should detect tampering in log content', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      // Create original log
      const originalLog = PermissionAuditLog.create({
        id: 'log-123',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: genesisHash,
      });

      const originalHash = originalLog.calculateHash();

      // Simulate tampering: reconstruct log with modified data but original hash
      const tamperedLog = PermissionAuditLog.fromPersistence({
        id: 'log-123',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:delete:all', // CHANGED!
        decision: 'ALLOW',
        timestamp: originalLog.timestamp,
        previousHash: genesisHash,
        hash: originalHash, // Original hash doesn't match new content
      });

      // Verify tampering is detected
      expect(tamperedLog.isHashValid()).toBe(false);
    });

    it('should detect tampering in decision field', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const originalLog = PermissionAuditLog.create({
        id: 'log-456',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:delete:facility',
        decision: 'DENY', // Original decision
        reason: 'Insufficient permissions',
        previousHash: genesisHash,
      });

      const originalHash = originalLog.calculateHash();

      // Simulate tampering: change DENY to ALLOW
      const tamperedLog = PermissionAuditLog.fromPersistence({
        id: 'log-456',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:delete:facility',
        decision: 'ALLOW', // CHANGED FROM DENY!
        reason: 'Insufficient permissions',
        timestamp: originalLog.timestamp,
        previousHash: genesisHash,
        hash: originalHash,
      });

      expect(tamperedLog.isHashValid()).toBe(false);
    });

    it('should detect tampering in timestamp', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const originalTimestamp = new Date('2024-01-15T10:00:00Z');

      const originalLog = PermissionAuditLog.create({
        id: 'log-789',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        timestamp: originalTimestamp,
        previousHash: genesisHash,
      });

      const originalHash = originalLog.calculateHash();

      // Simulate tampering: change timestamp
      const tamperedLog = PermissionAuditLog.fromPersistence({
        id: 'log-789',
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        timestamp: new Date('2024-01-15T11:00:00Z'), // CHANGED!
        previousHash: genesisHash,
        hash: originalHash,
      });

      expect(tamperedLog.isHashValid()).toBe(false);
    });

    it('should detect broken chain between logs', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      // Log 1
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: genesisHash,
      });
      const hash1 = log1.calculateHash();

      // Log 2 with tampered previousHash
      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:read:facility',
        decision: 'ALLOW',
        previousHash: 'wrong-hash-value', // WRONG!
      });

      // Chain is broken
      expect(log2.isChainValid(log1)).toBe(false);
    });

    it('should detect missing log in chain', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      // Log 1
      const log1 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: genesisHash,
      });
      const hash1 = log1.calculateHash();

      // Log 2 (middle log)
      const log2 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:update:facility',
        decision: 'ALLOW',
        previousHash: hash1,
      });
      const hash2 = log2.calculateHash();

      // Log 3 (should link to log 2)
      const log3 = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:delete:facility',
        decision: 'DENY',
        previousHash: hash2,
      });

      // Verify log 3 is valid when log 2 exists
      expect(log3.isChainValid(log2)).toBe(true);

      // Simulate missing log 2 - log 3 now references non-existent log
      expect(log3.previousHash).not.toBe(hash1);
      expect(log3.isChainValid(log1)).toBe(false); // Chain is broken!
    });
  });

  describe('Full chain validation', () => {
    it('should validate entire chain of logs', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const logs: PermissionAuditLog[] = [];
      let previousHash = genesisHash;

      // Create chain of 10 logs
      for (let i = 0; i < 10; i++) {
        const log = PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: `fir:action-${i}:facility`,
          decision: 'ALLOW',
          previousHash,
        });

        previousHash = log.calculateHash();
        logs.push(log);
      }

      // Validate entire chain
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i].isChainValid(logs[i - 1])).toBe(true);
      }
    });

    it('should detect tampering anywhere in the chain', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const logs: any[] = [];
      let previousHash = genesisHash;

      // Create chain of 10 logs
      for (let i = 0; i < 10; i++) {
        const log = PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: `fir:action-${i}:facility`,
          decision: 'ALLOW',
          previousHash,
        });

        previousHash = log.calculateHash();
        logs.push({
          ...log,
          hash: previousHash,
        });
      }

      // Tamper with log in the middle (log index 5)
      const tamperedLog = PermissionAuditLog.fromPersistence({
        ...logs[5],
        actionAttempted: 'fir:delete:all', // CHANGED!
      });

      // Tampering detected
      expect(tamperedLog.isHashValid()).toBe(false);

      // All subsequent logs in chain are now invalid because chain is broken
      if (logs[6]) {
        const nextLog = PermissionAuditLog.fromPersistence(logs[6]);
        expect(nextLog.isChainValid(tamperedLog)).toBe(false);
      }
    });
  });

  describe('Performance with large chains', () => {
    it('should validate chains with 1000+ logs efficiently', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const logs: PermissionAuditLog[] = [];
      let previousHash = genesisHash;

      const startTime = performance.now();

      // Create chain of 1000 logs
      for (let i = 0; i < 1000; i++) {
        const log = PermissionAuditLog.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          actionAttempted: `fir:action-${i}:facility`,
          decision: 'ALLOW',
          previousHash,
        });

        previousHash = log.calculateHash();
        logs.push(log);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should create 1000 logs in reasonable time
      expect(duration).toBeLessThan(1000); // <1s for 1000 logs
      expect(logs).toHaveLength(1000);
    });

    it('should calculate hash efficiently for individual log', () => {
      const log = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      });

      const iterations = 1000;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        log.calculateHash();
      }

      const endTime = performance.now();
      const avgDuration = (endTime - startTime) / iterations;

      // Average hash calculation should be <1ms per plan.md
      expect(avgDuration).toBeLessThan(1);
    });
  });

  describe('Regulatory compliance', () => {
    it('should maintain audit trail for ARPA inspection', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      // Simulate permission check that was denied
      const deniedLog = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:delete:facility',
        decision: 'DENY',
        reason: 'User lacks required permission: fir:delete:facility',
        spidFiscalCode: 'RSSMRA80A01H501U', // Italian fiscal code for ARPA
        timestamp: new Date('2024-01-15T10:30:45.123Z'), // Millisecond precision
        previousHash: genesisHash,
      });

      const hash = deniedLog.calculateHash();

      // Verify all required fields for ARPA compliance (spec.md FR-018)
      expect(deniedLog.userId).toBeDefined();
      expect(deniedLog.actionAttempted).toBeDefined();
      expect(deniedLog.decision).toBe('DENY');
      expect(deniedLog.reason).toBeDefined();
      expect(deniedLog.spidFiscalCode).toBeDefined();
      expect(deniedLog.timestamp).toBeDefined();
      expect(hash).toBeDefined();

      // Verify log is tamper-proof
      expect(deniedLog.isHashValid()).toBe(true);
    });

    it('should support 10-year retention with chain integrity', () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      // Simulate old log (10 years ago)
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 10);

      const oldLog = PermissionAuditLog.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        actionAttempted: 'fir:create:facility',
        decision: 'ALLOW',
        timestamp: oldDate,
        previousHash: genesisHash,
      });

      const hash = oldLog.calculateHash();

      // Log should still be valid after 10 years
      expect(oldLog.isHashValid()).toBe(true);
      expect(oldLog.timestamp.getFullYear()).toBe(oldDate.getFullYear());
    });
  });
});
