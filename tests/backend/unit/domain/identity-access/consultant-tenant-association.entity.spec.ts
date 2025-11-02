import { ConsultantTenantAssociation } from '../../../../../apps/backend/src/domain/identity-access/consultant-tenant-association.entity';

/**
 * T095: Unit test for ConsultantTenantAssociation entity
 * Tests business rules for consultant-tenant relationships
 *
 * Business Rules to Test:
 * - Consultant can be associated with multiple tenants
 * - Association can expire (optional expiration date)
 * - Association can be deactivated without deletion
 * - Cannot create duplicate active associations
 * - Expired associations are automatically inactive
 */
describe('ConsultantTenantAssociation Entity', () => {
  const mockConsultantUserId = 'consultant-123';
  const mockTenantId = 'tenant-abc';
  const mockAddedBy = 'admin-456';
  const mockRoleId = 'role-consultant-789';

  describe('create', () => {
    it('should create a valid consultant-tenant association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      expect(association).toBeDefined();
      expect(association.consultantUserId).toBe(mockConsultantUserId);
      expect(association.tenantId).toBe(mockTenantId);
      expect(association.roleId).toBe(mockRoleId);
      expect(association.addedBy).toBe(mockAddedBy);
      expect(association.isActive).toBe(true);
      expect(association.expiresAt).toBeNull();
    });

    it('should create association with expiration date', () => {
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 6);

      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: futureDate,
      });

      expect(association.expiresAt).toEqual(futureDate);
      expect(association.isActive).toBe(true);
    });

    it('should throw error if consultantUserId is empty', () => {
      expect(() => {
        ConsultantTenantAssociation.create({
          consultantUserId: '',
          tenantId: mockTenantId,
          roleId: mockRoleId,
          addedBy: mockAddedBy,
          expiresAt: null,
        });
      }).toThrow('Consultant user ID is required');
    });

    it('should throw error if tenantId is empty', () => {
      expect(() => {
        ConsultantTenantAssociation.create({
          consultantUserId: mockConsultantUserId,
          tenantId: '',
          roleId: mockRoleId,
          addedBy: mockAddedBy,
          expiresAt: null,
        });
      }).toThrow('Tenant ID is required');
    });

    it('should throw error if roleId is empty', () => {
      expect(() => {
        ConsultantTenantAssociation.create({
          consultantUserId: mockConsultantUserId,
          tenantId: mockTenantId,
          roleId: '',
          addedBy: mockAddedBy,
          expiresAt: null,
        });
      }).toThrow('Role ID is required');
    });

    it('should throw error if expiration date is in the past', () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);

      expect(() => {
        ConsultantTenantAssociation.create({
          consultantUserId: mockConsultantUserId,
          tenantId: mockTenantId,
          roleId: mockRoleId,
          addedBy: mockAddedBy,
          expiresAt: pastDate,
        });
      }).toThrow('Expiration date cannot be in the past');
    });
  });

  describe('isExpired', () => {
    it('should return false if no expiration date', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      expect(association.isExpired()).toBe(false);
    });

    it('should return false if expiration date is in the future', () => {
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 6);

      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: futureDate,
      });

      expect(association.isExpired()).toBe(false);
    });

    it('should return true if expiration date is in the past', () => {
      // Create association without validation, then manually set expired date
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      // Manually set expired date (simulating time passing)
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);
      (association as any).expiresAt = pastDate;

      expect(association.isExpired()).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an active association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      expect(association.isActive).toBe(true);

      association.deactivate();

      expect(association.isActive).toBe(false);
    });

    it('should throw error when deactivating already inactive association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      association.deactivate();

      expect(() => {
        association.deactivate();
      }).toThrow('Association is already inactive');
    });
  });

  describe('reactivate', () => {
    it('should reactivate an inactive association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      association.deactivate();
      expect(association.isActive).toBe(false);

      association.reactivate();
      expect(association.isActive).toBe(true);
    });

    it('should throw error when reactivating already active association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      expect(() => {
        association.reactivate();
      }).toThrow('Association is already active');
    });

    it('should throw error when reactivating expired association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      // Manually expire
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);
      (association as any).expiresAt = pastDate;

      association.deactivate();

      expect(() => {
        association.reactivate();
      }).toThrow('Cannot reactivate expired association');
    });
  });

  describe('extendExpiration', () => {
    it('should extend expiration date', () => {
      const originalExpiry = new Date();
      originalExpiry.setMonth(originalExpiry.getMonth() + 3);

      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: originalExpiry,
      });

      const newExpiry = new Date();
      newExpiry.setMonth(newExpiry.getMonth() + 6);

      association.extendExpiration(newExpiry);

      expect(association.expiresAt).toEqual(newExpiry);
    });

    it('should throw error if new expiration is before current expiration', () => {
      const originalExpiry = new Date();
      originalExpiry.setMonth(originalExpiry.getMonth() + 6);

      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: originalExpiry,
      });

      const earlierExpiry = new Date();
      earlierExpiry.setMonth(earlierExpiry.getMonth() + 3);

      expect(() => {
        association.extendExpiration(earlierExpiry);
      }).toThrow('New expiration date must be after current expiration');
    });

    it('should allow setting expiration when none exists', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      const newExpiry = new Date();
      newExpiry.setMonth(newExpiry.getMonth() + 6);

      association.extendExpiration(newExpiry);

      expect(association.expiresAt).toEqual(newExpiry);
    });
  });

  describe('isActiveAndNotExpired', () => {
    it('should return true for active and non-expired association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      expect(association.isActiveAndNotExpired()).toBe(true);
    });

    it('should return false for inactive association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      association.deactivate();

      expect(association.isActiveAndNotExpired()).toBe(false);
    });

    it('should return false for expired association', () => {
      const association = ConsultantTenantAssociation.create({
        consultantUserId: mockConsultantUserId,
        tenantId: mockTenantId,
        roleId: mockRoleId,
        addedBy: mockAddedBy,
        expiresAt: null,
      });

      // Manually expire
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);
      (association as any).expiresAt = pastDate;

      expect(association.isActiveAndNotExpired()).toBe(false);
    });
  });
});
