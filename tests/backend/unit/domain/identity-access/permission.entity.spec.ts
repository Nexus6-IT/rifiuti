import { Permission } from '../../../../../apps/backend/src/domain/identity-access/permission.entity';

/**
 * Permission Entity Unit Tests
 * Testing business rules per plan.md FR-001, FR-002
 *
 * Business Rules:
 * 1. Permission format must be "resource:action:scope"
 * 2. Resource, action, and scope must be non-empty
 * 3. Scope must be one of: own, facility, all
 * 4. Permission must be unique (enforced at repository level, validated here)
 * 5. Sensitive permissions must be flagged (delete, approve, configure)
 */
describe('Permission Entity', () => {
  describe('Permission Creation', () => {
    it('should create a valid permission with correct format', () => {
      // Arrange & Act
      const permission = Permission.create({
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Create FIR documents for facility',
        isSensitive: false,
        module: 'FIR',
      });

      // Assert
      expect(permission.resource).toBe('fir');
      expect(permission.action).toBe('create');
      expect(permission.scope).toBe('facility');
      expect(permission.description).toBe('Create FIR documents for facility');
      expect(permission.isSensitive).toBe(false);
      expect(permission.module).toBe('FIR');
      expect(permission.id).toBeDefined();
      expect(permission.createdAt).toBeInstanceOf(Date);
    });

    it('should throw error if resource is empty', () => {
      // Arrange & Act & Assert
      expect(() => {
        Permission.create({
          resource: '',
          action: 'create',
          scope: 'facility',
          description: 'Test',
          isSensitive: false,
          module: 'FIR',
        });
      }).toThrow('Resource cannot be empty');
    });

    it('should throw error if action is empty', () => {
      // Arrange & Act & Assert
      expect(() => {
        Permission.create({
          resource: 'fir',
          action: '',
          scope: 'facility',
          description: 'Test',
          isSensitive: false,
          module: 'FIR',
        });
      }).toThrow('Action cannot be empty');
    });

    it('should throw error if scope is invalid', () => {
      // Arrange & Act & Assert
      expect(() => {
        Permission.create({
          resource: 'fir',
          action: 'create',
          scope: 'invalid',
          description: 'Test',
          isSensitive: false,
          module: 'FIR',
        });
      }).toThrow('Scope must be one of: own, facility, all');
    });

    it('should accept valid scope values: own, facility, all', () => {
      // Arrange
      const validScopes = ['own', 'facility', 'all'];

      // Act & Assert
      validScopes.forEach((scope) => {
        const permission = Permission.create({
          resource: 'fir',
          action: 'read',
          scope,
          description: `Read FIR - ${scope} scope`,
          isSensitive: false,
          module: 'FIR',
        });

        expect(permission.scope).toBe(scope);
      });
    });

    it('should mark delete actions as sensitive', () => {
      // Arrange & Act
      const permission = Permission.create({
        resource: 'fir',
        action: 'delete',
        scope: 'facility',
        description: 'Delete FIR documents',
        isSensitive: true,
        module: 'FIR',
      });

      // Assert
      expect(permission.isSensitive).toBe(true);
    });

    it('should mark approve actions as sensitive', () => {
      // Arrange & Act
      const permission = Permission.create({
        resource: 'user',
        action: 'approve',
        scope: 'all',
        description: 'Approve user registration',
        isSensitive: true,
        module: 'User',
      });

      // Assert
      expect(permission.isSensitive).toBe(true);
    });

    it('should mark configure actions as sensitive', () => {
      // Arrange & Act
      const permission = Permission.create({
        resource: 'system',
        action: 'configure',
        scope: 'all',
        description: 'Configure system settings',
        isSensitive: true,
        module: 'System',
      });

      // Assert
      expect(permission.isSensitive).toBe(true);
    });
  });

  describe('Permission Format String', () => {
    it('should generate correct permission string format', () => {
      // Arrange
      const permission = Permission.create({
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Create FIR',
        isSensitive: false,
        module: 'FIR',
      });

      // Act
      const permissionString = permission.toString();

      // Assert
      expect(permissionString).toBe('fir:create:facility');
    });

    it('should parse permission string to components', () => {
      // Arrange
      const permissionString = 'fir:delete:all';

      // Act
      const permission = Permission.fromString(
        permissionString,
        'Delete all FIRs',
        'FIR',
      );

      // Assert
      expect(permission.resource).toBe('fir');
      expect(permission.action).toBe('delete');
      expect(permission.scope).toBe('all');
      expect(permission.toString()).toBe(permissionString);
    });

    it('should throw error for invalid permission string format', () => {
      // Arrange
      const invalidFormats = [
        'fir:create', // Missing scope
        'fir', // Missing action and scope
        'fir:create:facility:extra', // Too many parts
        ':create:facility', // Missing resource
        'fir::facility', // Missing action
        'fir:create:', // Missing scope
      ];

      // Act & Assert
      invalidFormats.forEach((invalidFormat) => {
        expect(() => {
          Permission.fromString(invalidFormat, 'Test', 'Test');
        }).toThrow('Invalid permission format. Expected: resource:action:scope');
      });
    });
  });

  describe('Permission Comparison', () => {
    it('should identify equal permissions', () => {
      // Arrange
      const perm1 = Permission.create({
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Create FIR',
        isSensitive: false,
        module: 'FIR',
      });

      const perm2 = Permission.create({
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Different description',
        isSensitive: false,
        module: 'FIR',
      });

      // Act & Assert
      expect(perm1.equals(perm2)).toBe(true);
    });

    it('should identify different permissions', () => {
      // Arrange
      const perm1 = Permission.create({
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Create FIR',
        isSensitive: false,
        module: 'FIR',
      });

      const perm2 = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'facility',
        description: 'Read FIR',
        isSensitive: false,
        module: 'FIR',
      });

      // Act & Assert
      expect(perm1.equals(perm2)).toBe(false);
    });
  });

  describe('Scope Hierarchy', () => {
    it('should identify scope level correctly', () => {
      // Arrange
      const ownScope = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'own',
        description: 'Read own FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      const facilityScope = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'facility',
        description: 'Read facility FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      const allScope = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'all',
        description: 'Read all FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      // Act & Assert
      expect(ownScope.getScopeLevel()).toBe(0);
      expect(facilityScope.getScopeLevel()).toBe(1);
      expect(allScope.getScopeLevel()).toBe(2);
    });

    it('should check if permission implies another (scope hierarchy)', () => {
      // Arrange
      const allScope = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'all',
        description: 'Read all FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      const facilityScope = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'facility',
        description: 'Read facility FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      const ownScope = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'own',
        description: 'Read own FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      // Act & Assert
      // "all" scope implies "facility" and "own"
      expect(allScope.implies(facilityScope)).toBe(true);
      expect(allScope.implies(ownScope)).toBe(true);

      // "facility" scope implies "own" but not "all"
      expect(facilityScope.implies(ownScope)).toBe(true);
      expect(facilityScope.implies(allScope)).toBe(false);

      // "own" scope doesn't imply others
      expect(ownScope.implies(facilityScope)).toBe(false);
      expect(ownScope.implies(allScope)).toBe(false);
    });

    it('should not imply permission with different resource or action', () => {
      // Arrange
      const firRead = Permission.create({
        resource: 'fir',
        action: 'read',
        scope: 'all',
        description: 'Read all FIRs',
        isSensitive: false,
        module: 'FIR',
      });

      const firCreate = Permission.create({
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Create FIR',
        isSensitive: false,
        module: 'FIR',
      });

      const facilityRead = Permission.create({
        resource: 'facility',
        action: 'read',
        scope: 'all',
        description: 'Read facilities',
        isSensitive: false,
        module: 'Facility',
      });

      // Act & Assert
      expect(firRead.implies(firCreate)).toBe(false); // Different action
      expect(firRead.implies(facilityRead)).toBe(false); // Different resource
    });
  });

  describe('Permission Reconstruction from Persistence', () => {
    it('should reconstruct permission from database data', () => {
      // Arrange
      const dbData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        resource: 'fir',
        action: 'create',
        scope: 'facility',
        description: 'Create FIR documents',
        isSensitive: false,
        module: 'FIR',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      // Act
      const permission = Permission.fromPersistence(dbData);

      // Assert
      expect(permission.id).toBe(dbData.id);
      expect(permission.resource).toBe(dbData.resource);
      expect(permission.action).toBe(dbData.action);
      expect(permission.scope).toBe(dbData.scope);
      expect(permission.description).toBe(dbData.description);
      expect(permission.isSensitive).toBe(dbData.isSensitive);
      expect(permission.module).toBe(dbData.module);
      expect(permission.createdAt).toEqual(dbData.createdAt);
      expect(permission.updatedAt).toEqual(dbData.updatedAt);
    });
  });
});
