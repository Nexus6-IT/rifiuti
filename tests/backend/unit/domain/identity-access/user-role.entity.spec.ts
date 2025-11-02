import { UserRole } from '../../../../../apps/backend/src/domain/identity-access/user-role.entity';

/**
 * UserRole Entity Unit Tests
 * Testing business rules per plan.md FR-006, FR-007
 *
 * Business Rules:
 * 1. UserRole must have userId, roleId, and tenantId
 * 2. UserRole can have expiration date
 * 3. UserRole can be facility-scoped
 * 4. UserRole can be delegated with justification
 * 5. Expired roles should be identifiable
 */
describe('UserRole Entity', () => {
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '123e4567-e89b-12d3-a456-426614174001';
  const mockRoleId = '123e4567-e89b-12d3-a456-426614174002';
  const mockAssignedBy = '123e4567-e89b-12d3-a456-426614174003';
  const mockFacilityId = '123e4567-e89b-12d3-a456-426614174004';

  describe('UserRole Creation', () => {
    it('should create a valid user role assignment', () => {
      // Arrange & Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      // Assert
      expect(userRole.userId).toBe(mockUserId);
      expect(userRole.roleId).toBe(mockRoleId);
      expect(userRole.tenantId).toBe(mockTenantId);
      expect(userRole.assignedBy).toBe(mockAssignedBy);
      expect(userRole.id).toBeDefined();
      expect(userRole.assignedAt).toBeInstanceOf(Date);
      expect(userRole.expiresAt).toBeNull();
      expect(userRole.facilityIds).toBeNull();
      expect(userRole.isDelegated).toBe(false);
    });

    it('should throw error if userId is missing', () => {
      // Arrange & Act & Assert
      expect(() => {
        UserRole.create({
          userId: '',
          roleId: mockRoleId,
          tenantId: mockTenantId,
          assignedBy: mockAssignedBy,
        });
      }).toThrow('User ID is required');
    });

    it('should throw error if roleId is missing', () => {
      // Arrange & Act & Assert
      expect(() => {
        UserRole.create({
          userId: mockUserId,
          roleId: '',
          tenantId: mockTenantId,
          assignedBy: mockAssignedBy,
        });
      }).toThrow('Role ID is required');
    });

    it('should throw error if tenantId is missing', () => {
      // Arrange & Act & Assert
      expect(() => {
        UserRole.create({
          userId: mockUserId,
          roleId: mockRoleId,
          tenantId: '',
          assignedBy: mockAssignedBy,
        });
      }).toThrow('Tenant ID is required');
    });

    it('should throw error if assignedBy is missing', () => {
      // Arrange & Act & Assert
      expect(() => {
        UserRole.create({
          userId: mockUserId,
          roleId: mockRoleId,
          tenantId: mockTenantId,
          assignedBy: '',
        });
      }).toThrow('Assigned by user ID is required');
    });
  });

  describe('UserRole with Expiration', () => {
    it('should create user role with expiration date', () => {
      // Arrange
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

      // Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        expiresAt,
      });

      // Assert
      expect(userRole.expiresAt).toEqual(expiresAt);
      expect(userRole.isExpired()).toBe(false);
    });

    it('should identify expired user roles', () => {
      // Arrange
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() - 1); // Yesterday

      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        expiresAt,
      });

      // Act & Assert
      expect(userRole.isExpired()).toBe(true);
    });

    it('should identify non-expiring user roles', () => {
      // Arrange
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        expiresAt: null,
      });

      // Act & Assert
      expect(userRole.isExpired()).toBe(false);
      expect(userRole.isPermanent()).toBe(true);
    });

    it('should throw error if expiration date is in the past', () => {
      // Arrange
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      // Act & Assert
      expect(() => {
        UserRole.create({
          userId: mockUserId,
          roleId: mockRoleId,
          tenantId: mockTenantId,
          assignedBy: mockAssignedBy,
          expiresAt: pastDate,
        });
      }).toThrow('Expiration date must be in the future');
    });
  });

  describe('Facility-Scoped UserRole', () => {
    it('should create facility-scoped user role', () => {
      // Arrange & Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        facilityIds: [mockFacilityId],
      });

      // Assert
      expect(userRole.facilityIds).toEqual([mockFacilityId]);
      expect(userRole.isFacilityScoped()).toBe(true);
    });

    it('should create tenant-wide user role when no facilities specified', () => {
      // Arrange & Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        facilityIds: null,
      });

      // Assert
      expect(userRole.facilityIds).toBeNull();
      expect(userRole.isFacilityScoped()).toBe(false);
    });

    it('should support multiple facilities', () => {
      // Arrange
      const facilityIds = [mockFacilityId, '123e4567-e89b-12d3-a456-426614174005'];

      // Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        facilityIds,
      });

      // Assert
      expect(userRole.facilityIds).toEqual(facilityIds);
      expect(userRole.facilityIds?.length).toBe(2);
    });

    it('should check if role applies to specific facility', () => {
      // Arrange
      const facilityIds = [mockFacilityId];
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        facilityIds,
      });

      // Act & Assert
      expect(userRole.appliesToFacility(mockFacilityId)).toBe(true);
      expect(userRole.appliesToFacility('other-facility-id')).toBe(false);
    });

    it('should apply to all facilities when not facility-scoped', () => {
      // Arrange
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        facilityIds: null,
      });

      // Act & Assert
      expect(userRole.appliesToFacility(mockFacilityId)).toBe(true);
      expect(userRole.appliesToFacility('any-facility-id')).toBe(true);
    });
  });

  describe('Delegated UserRole', () => {
    it('should create delegated user role with justification', () => {
      // Arrange & Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        isDelegated: true,
        delegationReason: 'User on leave - delegating to backup',
      });

      // Assert
      expect(userRole.isDelegated).toBe(true);
      expect(userRole.delegationReason).toBe('User on leave - delegating to backup');
    });

    it('should throw error if delegated without reason', () => {
      // Arrange & Act & Assert
      expect(() => {
        UserRole.create({
          userId: mockUserId,
          roleId: mockRoleId,
          tenantId: mockTenantId,
          assignedBy: mockAssignedBy,
          isDelegated: true,
          delegationReason: '',
        });
      }).toThrow('Delegation reason is required for delegated roles');
    });

    it('should not require delegation reason for non-delegated roles', () => {
      // Arrange & Act
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        isDelegated: false,
      });

      // Assert
      expect(userRole.isDelegated).toBe(false);
      expect(userRole.delegationReason).toBeNull();
    });
  });

  describe('UserRole Revocation', () => {
    it('should revoke user role', () => {
      // Arrange
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      // Act
      userRole.revoke();

      // Assert
      expect(userRole.isRevoked()).toBe(true);
      expect(userRole.isActive()).toBe(false);
    });

    it('should throw error when revoking already revoked role', () => {
      // Arrange
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });
      userRole.revoke();

      // Act & Assert
      expect(() => {
        userRole.revoke();
      }).toThrow('User role is already revoked');
    });
  });

  describe('UserRole Active Status', () => {
    it('should be active when not expired and not revoked', () => {
      // Arrange
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        expiresAt: futureDate,
      });

      // Act & Assert
      expect(userRole.isActive()).toBe(true);
    });

    it('should be inactive when expired', () => {
      // Arrange
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      // Manually set expiration to past (simulating time passing)
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      (userRole as any).expiresAt = pastDate;

      // Act & Assert
      expect(userRole.isActive()).toBe(false);
    });

    it('should be inactive when revoked', () => {
      // Arrange
      const userRole = UserRole.create({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });
      userRole.revoke();

      // Act & Assert
      expect(userRole.isActive()).toBe(false);
    });
  });

  describe('UserRole Reconstruction from Persistence', () => {
    it('should reconstruct user role from database data', () => {
      // Arrange
      const dbData = {
        id: '123e4567-e89b-12d3-a456-426614174006',
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        assignedAt: new Date('2024-01-01'),
        expiresAt: new Date('2024-12-31'),
        facilityIds: [mockFacilityId],
        isDelegated: true,
        delegationReason: 'Test delegation',
      };

      // Act
      const userRole = UserRole.fromPersistence(dbData);

      // Assert
      expect(userRole.id).toBe(dbData.id);
      expect(userRole.userId).toBe(dbData.userId);
      expect(userRole.roleId).toBe(dbData.roleId);
      expect(userRole.tenantId).toBe(dbData.tenantId);
      expect(userRole.assignedBy).toBe(dbData.assignedBy);
      expect(userRole.assignedAt).toEqual(dbData.assignedAt);
      expect(userRole.expiresAt).toEqual(dbData.expiresAt);
      expect(userRole.facilityIds).toEqual(dbData.facilityIds);
      expect(userRole.isDelegated).toBe(dbData.isDelegated);
      expect(userRole.delegationReason).toBe(dbData.delegationReason);
    });
  });
});
