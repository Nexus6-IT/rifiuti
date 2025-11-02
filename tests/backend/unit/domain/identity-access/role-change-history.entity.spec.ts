import { RoleChangeHistory } from '../../../../../apps/backend/src/domain/identity-access/role-change-history.entity';

/**
 * Unit tests for RoleChangeHistory entity
 * Tests role assignment/revocation audit trail
 * T134: RoleChangeHistory entity tests per User Story 4
 *
 * Purpose: Track all role changes for compliance and historical reconstruction
 *
 * Requirements from spec.md:
 * - Track who made the change, when, and why
 * - Store old role and new role for comparison
 * - Include tenant context
 * - Support historical permission reconstruction (US4 acceptance scenario 5)
 * - Immutable once created
 *
 * Requirements from plan.md:
 * - 10-year retention for ARPA compliance
 * - Support role hierarchy changes over time
 */
describe('RoleChangeHistory Entity', () => {
  // Mock data
  const mockUserId = 'user-123';
  const mockTenantId = 'tenant-456';
  const mockOldRoleId = 'role-operator';
  const mockNewRoleId = 'role-manager';
  const mockChangedBy = 'admin-789';
  const mockReason = 'Promoted to manager role after 6 months of service';
  const mockEffectiveDate = new Date('2024-01-15T10:30:00Z');

  describe('Factory method: create', () => {
    it('should create role change history with all required fields', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
        effectiveDate: mockEffectiveDate,
      });

      expect(history).toBeDefined();
      expect(history.userId).toBe(mockUserId);
      expect(history.tenantId).toBe(mockTenantId);
      expect(history.oldRoleId).toBe(mockOldRoleId);
      expect(history.newRoleId).toBe(mockNewRoleId);
      expect(history.changedBy).toBe(mockChangedBy);
      expect(history.reason).toBe(mockReason);
      expect(history.effectiveDate).toEqual(mockEffectiveDate);
    });

    it('should auto-generate ID if not provided', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      expect(history.id).toBeDefined();
      expect(typeof history.id).toBe('string');
      expect(history.id.length).toBeGreaterThan(0);
    });

    it('should auto-generate timestamp if not provided', () => {
      const beforeCreate = Date.now();

      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      const afterCreate = Date.now();

      expect(history.timestamp).toBeDefined();
      expect(history.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCreate);
      expect(history.timestamp.getTime()).toBeLessThanOrEqual(afterCreate);
    });

    it('should use timestamp as effectiveDate if not provided', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      expect(history.effectiveDate).toEqual(history.timestamp);
    });

    it('should throw error if userId is missing', () => {
      expect(() => {
        RoleChangeHistory.create({
          userId: '',
          tenantId: mockTenantId,
          newRoleId: mockNewRoleId,
          changedBy: mockChangedBy,
          reason: mockReason,
        });
      }).toThrow('userId is required');
    });

    it('should throw error if tenantId is missing', () => {
      expect(() => {
        RoleChangeHistory.create({
          userId: mockUserId,
          tenantId: '',
          newRoleId: mockNewRoleId,
          changedBy: mockChangedBy,
          reason: mockReason,
        });
      }).toThrow('tenantId is required');
    });

    it('should throw error if newRoleId is missing', () => {
      expect(() => {
        RoleChangeHistory.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          newRoleId: '',
          changedBy: mockChangedBy,
          reason: mockReason,
        });
      }).toThrow('newRoleId is required');
    });

    it('should throw error if changedBy is missing', () => {
      expect(() => {
        RoleChangeHistory.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          newRoleId: mockNewRoleId,
          changedBy: '',
          reason: mockReason,
        });
      }).toThrow('changedBy is required');
    });

    it('should throw error if reason is missing', () => {
      expect(() => {
        RoleChangeHistory.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          newRoleId: mockNewRoleId,
          changedBy: mockChangedBy,
          reason: '',
        });
      }).toThrow('reason is required');
    });

    it('should allow null oldRoleId for initial role assignment', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: null,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'Initial role assignment',
      });

      expect(history.oldRoleId).toBeNull();
      expect(history.isInitialAssignment()).toBe(true);
    });

    it('should allow null newRoleId for role revocation', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: null,
        changedBy: mockChangedBy,
        reason: 'User left company',
      });

      expect(history.newRoleId).toBeNull();
      expect(history.isRevocation()).toBe(true);
    });

    it('should throw error if both oldRoleId and newRoleId are null', () => {
      expect(() => {
        RoleChangeHistory.create({
          userId: mockUserId,
          tenantId: mockTenantId,
          oldRoleId: null,
          newRoleId: null,
          changedBy: mockChangedBy,
          reason: 'Invalid change',
        });
      }).toThrow('At least one of oldRoleId or newRoleId must be provided');
    });
  });

  describe('Change type detection', () => {
    it('should detect initial assignment (no old role)', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: null,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'Initial assignment',
      });

      expect(history.isInitialAssignment()).toBe(true);
      expect(history.isRevocation()).toBe(false);
      expect(history.isRoleChange()).toBe(false);
    });

    it('should detect revocation (no new role)', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: null,
        changedBy: mockChangedBy,
        reason: 'User deactivated',
      });

      expect(history.isRevocation()).toBe(true);
      expect(history.isInitialAssignment()).toBe(false);
      expect(history.isRoleChange()).toBe(false);
    });

    it('should detect role change (has both old and new roles)', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'Promotion',
      });

      expect(history.isRoleChange()).toBe(true);
      expect(history.isInitialAssignment()).toBe(false);
      expect(history.isRevocation()).toBe(false);
    });
  });

  describe('Historical reconstruction support', () => {
    it('should provide role ID at specific timestamp (before effective date)', () => {
      const effectiveDate = new Date('2024-01-15T10:00:00Z');

      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'Promotion',
        effectiveDate,
      });

      // Query for time before effective date
      const queryDate = new Date('2024-01-15T09:00:00Z');

      expect(history.getRoleAtTime(queryDate)).toBe(mockOldRoleId);
    });

    it('should provide role ID at specific timestamp (after effective date)', () => {
      const effectiveDate = new Date('2024-01-15T10:00:00Z');

      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'Promotion',
        effectiveDate,
      });

      // Query for time after effective date
      const queryDate = new Date('2024-01-15T11:00:00Z');

      expect(history.getRoleAtTime(queryDate)).toBe(mockNewRoleId);
    });

    it('should provide role ID at exact effective date', () => {
      const effectiveDate = new Date('2024-01-15T10:00:00Z');

      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'Promotion',
        effectiveDate,
      });

      // Query for exact effective date
      expect(history.getRoleAtTime(effectiveDate)).toBe(mockNewRoleId);
    });
  });

  describe('Change metadata', () => {
    it('should store changed by user ID', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      expect(history.changedBy).toBe(mockChangedBy);
    });

    it('should store reason for change', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      expect(history.reason).toBe(mockReason);
    });

    it('should store optional metadata (e.g., ticket ID, approval ID)', () => {
      const metadata = {
        ticketId: 'JIRA-1234',
        approvalId: 'approval-5678',
        approvedBy: 'manager-abc',
      };

      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
        metadata,
      });

      expect(history.metadata).toEqual(metadata);
    });
  });

  describe('Immutability', () => {
    it('should not allow modification after creation', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      // Attempt to modify should fail
      expect(() => {
        (history as any).newRoleId = 'different-role';
      }).toThrow();
    });

    it('should not provide update methods', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
      });

      expect((history as any).update).toBeUndefined();
      expect((history as any).setNewRole).toBeUndefined();
      expect((history as any).modify).toBeUndefined();
    });
  });

  describe('Serialization for persistence', () => {
    it('should convert to plain object for persistence', () => {
      const history = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
        effectiveDate: mockEffectiveDate,
      });

      const plainObject = history.toPersistence();

      expect(plainObject).toEqual({
        id: history.id,
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
        timestamp: history.timestamp,
        effectiveDate: mockEffectiveDate,
        metadata: undefined,
      });
    });

    it('should reconstruct from persistence', () => {
      const timestamp = new Date();
      const id = 'test-id-123';

      const persistedData = {
        id,
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockOldRoleId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: mockReason,
        timestamp,
        effectiveDate: mockEffectiveDate,
      };

      const history = RoleChangeHistory.fromPersistence(persistedData);

      expect(history.id).toBe(id);
      expect(history.userId).toBe(mockUserId);
      expect(history.timestamp).toEqual(timestamp);
      expect(history.effectiveDate).toEqual(mockEffectiveDate);
    });
  });

  describe('Chronological ordering', () => {
    it('should support comparison by effectiveDate', () => {
      const history1 = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        newRoleId: mockNewRoleId,
        changedBy: mockChangedBy,
        reason: 'First change',
        effectiveDate: new Date('2024-01-01'),
      });

      const history2 = RoleChangeHistory.create({
        userId: mockUserId,
        tenantId: mockTenantId,
        oldRoleId: mockNewRoleId,
        newRoleId: 'role-senior',
        changedBy: mockChangedBy,
        reason: 'Second change',
        effectiveDate: new Date('2024-06-01'),
      });

      expect(history1.isBefore(history2)).toBe(true);
      expect(history2.isAfter(history1)).toBe(true);
    });
  });
});
