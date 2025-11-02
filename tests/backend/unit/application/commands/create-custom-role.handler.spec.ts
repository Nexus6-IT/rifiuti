import { Test, TestingModule } from '@nestjs/testing';
import { CreateCustomRoleCommandHandler } from '../../../../../apps/backend/src/application/commands/handlers/create-custom-role.handler';
import { CreateCustomRoleCommand } from '../../../../../apps/backend/src/application/commands/create-custom-role.command';
import { RoleRepository } from '../../../../../apps/backend/src/domain/identity-access/role.repository.interface';
import { Role } from '../../../../../apps/backend/src/domain/identity-access/role.entity';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * CreateCustomRoleCommandHandler Tests
 * T162: Unit test for CreateCustomRoleCommand handler per User Story 5
 *
 * Purpose: Test permission matrix validation and custom role creation
 *
 * Requirements from spec.md FR-011:
 * - Validate permission format (resource:action:scope)
 * - Prevent duplicate permission strings
 * - Enforce enterprise-only access
 * - Validate role name uniqueness per tenant
 *
 * Requirements from plan.md:
 * - Validate at least 1 permission required
 * - Validate max 100 permissions per role
 * - Audit all role creation events
 */
describe('CreateCustomRoleCommandHandler', () => {
  let handler: CreateCustomRoleCommandHandler;
  let roleRepository: jest.Mocked<RoleRepository>;

  const mockTenantId = 'tenant-123';
  const mockCreatedBy = 'admin-user-456';

  beforeEach(async () => {
    const mockRoleRepo: Partial<RoleRepository> = {
      findByName: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateCustomRoleCommandHandler,
        {
          provide: RoleRepository,
          useValue: mockRoleRepo,
        },
      ],
    }).compile();

    handler = module.get<CreateCustomRoleCommandHandler>(
      CreateCustomRoleCommandHandler,
    );
    roleRepository = module.get(RoleRepository) as jest.Mocked<RoleRepository>;
  });

  describe('Valid Role Creation', () => {
    it('should create custom role with valid permissions', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Custom Fleet Manager',
        'Manages specific vehicles',
        [
          'fir:create:facility',
          'fir:read:facility',
          'vehicle:read:all',
          'vehicle:update:all',
        ],
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null); // No duplicate
      roleRepository.save.mockImplementation(async (role) => role);

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBe('Custom Fleet Manager');
      expect(result.description).toBe('Manages specific vehicles');
      expect(result.permissions).toHaveLength(4);
      expect(result.isCustom).toBe(true);
      expect(result.tenantId).toBe(mockTenantId);
      expect(roleRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should create role with minimal permissions (1)', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'View Only',
        'Can only view FIRs',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null);
      roleRepository.save.mockImplementation(async (role) => role);

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0]).toBe('fir:read:facility');
    });

    it('should create role with maximum permissions (100)', async () => {
      // Arrange
      const permissions = Array.from({ length: 100 }, (_, i) => `resource:action${i}:scope`);

      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Super Admin',
        'All permissions',
        permissions,
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null);
      roleRepository.save.mockImplementation(async (role) => role);

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result.permissions).toHaveLength(100);
    });
  });

  describe('Permission Matrix Validation', () => {
    it('should reject role with no permissions', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Empty Role',
        'No permissions',
        [],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'At least 1 permission is required',
      );
    });

    it('should reject role with more than 100 permissions', async () => {
      // Arrange
      const permissions = Array.from({ length: 101 }, (_, i) => `resource:action${i}:scope`);

      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Too Many Permissions',
        'Exceeds limit',
        permissions,
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'Maximum 100 permissions allowed per role',
      );
    });

    it('should reject permissions with invalid format', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Invalid Format',
        'Bad permission format',
        ['invalid-permission', 'fir:read:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'Invalid permission format',
      );
    });

    it('should reject permissions missing resource', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Missing Resource',
        'Permission without resource',
        [':read:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject permissions missing action', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Missing Action',
        'Permission without action',
        ['fir::facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject permissions missing scope', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Missing Scope',
        'Permission without scope',
        ['fir:read:'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject duplicate permissions', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Duplicate Permissions',
        'Has duplicates',
        ['fir:read:facility', 'fir:read:facility', 'fir:create:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'Duplicate permissions are not allowed',
      );
    });

    it('should accept all valid scope values', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'All Scopes',
        'Tests all valid scopes',
        ['fir:read:own', 'fir:read:facility', 'fir:read:all'],
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null);
      roleRepository.save.mockImplementation(async (role) => role);

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result.permissions).toContain('fir:read:own');
      expect(result.permissions).toContain('fir:read:facility');
      expect(result.permissions).toContain('fir:read:all');
    });

    it('should reject invalid scope values', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Invalid Scope',
        'Has invalid scope',
        ['fir:read:invalid-scope'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'Invalid scope',
      );
    });
  });

  describe('Role Name Validation', () => {
    it('should reject duplicate role name in same tenant', async () => {
      // Arrange
      const existingRole = Role.create({
        name: 'Existing Role',
        description: 'Already exists',
        permissions: ['fir:read:facility'],
        tenantId: mockTenantId,
        isCustom: true,
      });

      roleRepository.findByName.mockResolvedValue(existingRole);

      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Existing Role',
        'Duplicate name',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'Role with this name already exists',
      );
    });

    it('should reject empty role name', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        '',
        'Empty name',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject role name exceeding 100 characters', async () => {
      // Arrange
      const longName = 'A'.repeat(101);

      const command = new CreateCustomRoleCommand(
        mockTenantId,
        longName,
        'Too long',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject system role names (ADMIN, OPERATOR, etc.)', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'ADMIN',
        'Reserved name',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(handler.execute(command)).rejects.toThrow(
        'Cannot use system role names',
      );
    });
  });

  describe('Tenant Isolation', () => {
    it('should allow same role name in different tenants', async () => {
      // Arrange
      const command1 = new CreateCustomRoleCommand(
        'tenant-1',
        'Custom Role',
        'Tenant 1 role',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      const command2 = new CreateCustomRoleCommand(
        'tenant-2',
        'Custom Role',
        'Tenant 2 role',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null);
      roleRepository.save.mockImplementation(async (role) => role);

      // Act
      const result1 = await handler.execute(command1);
      const result2 = await handler.execute(command2);

      // Assert
      expect(result1.name).toBe('Custom Role');
      expect(result2.name).toBe('Custom Role');
      expect(result1.tenantId).toBe('tenant-1');
      expect(result2.tenantId).toBe('tenant-2');
    });
  });

  describe('Audit Trail', () => {
    it('should record who created the role', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Audit Test',
        'Test audit',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null);
      roleRepository.save.mockImplementation(async (role) => role);

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result.createdBy).toBe(mockCreatedBy);
    });

    it('should record creation timestamp', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'Timestamp Test',
        'Test timestamp',
        ['fir:read:facility'],
        mockCreatedBy,
      );

      roleRepository.findByName.mockResolvedValue(null);
      roleRepository.save.mockImplementation(async (role) => role);

      const beforeTime = new Date();

      // Act
      const result = await handler.execute(command);

      const afterTime = new Date();

      // Assert
      expect(result.createdAt).toBeDefined();
      expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(result.createdAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});
