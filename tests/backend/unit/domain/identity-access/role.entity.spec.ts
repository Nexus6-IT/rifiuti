import { Role } from '../../../../../apps/backend/src/domain/identity-access/role.entity';

/**
 * Role Entity Unit Tests
 * Testing business rules per plan.md FR-004, FR-009
 *
 * Business Rules:
 * 1. System roles cannot be deleted
 * 2. Role names must be unique per tenant
 * 3. Role names must not be empty
 * 4. Role must belong to a tenant
 * 5. Only custom roles can be deleted
 */
describe('Role Entity', () => {
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '123e4567-e89b-12d3-a456-426614174001';

  describe('Role Creation', () => {
    it('should create a valid role with required properties', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE',
        description: 'Custom role for testing',
        isSystemRole: false,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.tenantId).toBe(mockTenantId);
      expect(role.name).toBe('CUSTOM_ROLE');
      expect(role.description).toBe('Custom role for testing');
      expect(role.isSystemRole).toBe(false);
      expect(role.createdBy).toBe(mockUserId);
      expect(role.id).toBeDefined();
      expect(role.createdAt).toBeInstanceOf(Date);
    });

    it('should throw error if tenant ID is missing', () => {
      // Arrange & Act & Assert
      expect(() => {
        Role.create({
          tenantId: '',
          name: 'CUSTOM_ROLE',
          description: 'Test',
          isSystemRole: false,
          createdBy: mockUserId,
        });
      }).toThrow('Tenant ID is required');
    });

    it('should throw error if role name is empty', () => {
      // Arrange & Act & Assert
      expect(() => {
        Role.create({
          tenantId: mockTenantId,
          name: '',
          description: 'Test',
          isSystemRole: false,
          createdBy: mockUserId,
        });
      }).toThrow('Role name cannot be empty');
    });

    it('should throw error if role name exceeds 100 characters', () => {
      // Arrange
      const longName = 'A'.repeat(101);

      // Act & Assert
      expect(() => {
        Role.create({
          tenantId: mockTenantId,
          name: longName,
          description: 'Test',
          isSystemRole: false,
          createdBy: mockUserId,
        });
      }).toThrow('Role name cannot exceed 100 characters');
    });

    it('should create system role when isSystemRole is true', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'ADMIN',
        description: 'System administrator role',
        isSystemRole: true,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.isSystemRole).toBe(true);
      expect(role.name).toBe('ADMIN');
    });

    it('should throw error if createdBy is missing', () => {
      // Arrange & Act & Assert
      expect(() => {
        Role.create({
          tenantId: mockTenantId,
          name: 'CUSTOM_ROLE',
          description: 'Test',
          isSystemRole: false,
          createdBy: '',
        });
      }).toThrow('Creator user ID is required');
    });
  });

  describe('Role Update', () => {
    it('should allow updating description of custom role', () => {
      // Arrange
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE',
        description: 'Original description',
        isSystemRole: false,
        createdBy: mockUserId,
      });

      // Act
      role.updateDescription('Updated description');

      // Assert
      expect(role.description).toBe('Updated description');
      expect(role.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw error when updating description of system role', () => {
      // Arrange
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'ADMIN',
        description: 'System administrator',
        isSystemRole: true,
        createdBy: mockUserId,
      });

      // Act & Assert
      expect(() => {
        role.updateDescription('New description');
      }).toThrow('System roles cannot be modified');
    });
  });

  describe('Role Deletion', () => {
    it('should allow marking custom role as deleted', () => {
      // Arrange
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE',
        description: 'Custom role',
        isSystemRole: false,
        createdBy: mockUserId,
      });

      // Act
      role.markAsDeleted();

      // Assert
      expect(role.isDeleted).toBe(true);
    });

    it('should throw error when attempting to delete system role', () => {
      // Arrange
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'ADMIN',
        description: 'System administrator',
        isSystemRole: true,
        createdBy: mockUserId,
      });

      // Act & Assert
      expect(() => {
        role.markAsDeleted();
      }).toThrow('System roles cannot be deleted');
    });

    it('should throw error when deleting already deleted role', () => {
      // Arrange
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE',
        description: 'Custom role',
        isSystemRole: false,
        createdBy: mockUserId,
      });
      role.markAsDeleted();

      // Act & Assert
      expect(() => {
        role.markAsDeleted();
      }).toThrow('Role is already deleted');
    });
  });

  describe('Role Name Validation', () => {
    it('should normalize role name to uppercase', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'custom_role',
        description: 'Test',
        isSystemRole: false,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.name).toBe('CUSTOM_ROLE');
    });

    it('should reject role names with special characters except underscore', () => {
      // Arrange & Act & Assert
      expect(() => {
        Role.create({
          tenantId: mockTenantId,
          name: 'CUSTOM-ROLE!',
          description: 'Test',
          isSystemRole: false,
          createdBy: mockUserId,
        });
      }).toThrow('Role name can only contain letters, numbers, and underscores');
    });

    it('should accept role names with underscores', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE_123',
        description: 'Test',
        isSystemRole: false,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.name).toBe('CUSTOM_ROLE_123');
    });
  });

  describe('System Role Identification', () => {
    it('should identify ADMIN as system role', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'ADMIN',
        description: 'Administrator',
        isSystemRole: true,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.isSystemRole).toBe(true);
    });

    it('should identify OPERATOR as system role', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'OPERATOR',
        description: 'Operator',
        isSystemRole: true,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.isSystemRole).toBe(true);
    });

    it('should identify custom role correctly', () => {
      // Arrange & Act
      const role = Role.create({
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE',
        description: 'Custom',
        isSystemRole: false,
        createdBy: mockUserId,
      });

      // Assert
      expect(role.isSystemRole).toBe(false);
    });
  });

  describe('Role Reconstruction from Persistence', () => {
    it('should reconstruct role from database data', () => {
      // Arrange
      const dbData = {
        id: '123e4567-e89b-12d3-a456-426614174002',
        tenantId: mockTenantId,
        name: 'CUSTOM_ROLE',
        description: 'Custom role',
        isSystemRole: false,
        createdBy: mockUserId,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      // Act
      const role = Role.fromPersistence(dbData);

      // Assert
      expect(role.id).toBe(dbData.id);
      expect(role.tenantId).toBe(dbData.tenantId);
      expect(role.name).toBe(dbData.name);
      expect(role.description).toBe(dbData.description);
      expect(role.isSystemRole).toBe(dbData.isSystemRole);
      expect(role.createdBy).toBe(dbData.createdBy);
      expect(role.createdAt).toEqual(dbData.createdAt);
      expect(role.updatedAt).toEqual(dbData.updatedAt);
    });
  });
});
