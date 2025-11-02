import { AssignRoleCommandHandler } from '../../../../../apps/backend/src/application/commands/handlers/assign-role.handler';
import { AssignRoleCommand } from '../../../../../apps/backend/src/application/commands/assign-role.command';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * AssignRoleCommandHandler Unit Tests
 * Testing business rules per plan.md FR-008, FR-009
 *
 * Business Rules:
 * 1. Must prevent removing last ADMIN from tenant (last admin protection)
 * 2. Must audit all role assignments
 * 3. Must invalidate user permission cache after assignment
 * 4. Must validate role exists and user exists
 * 5. Must enforce tenant isolation
 * 6. Must prevent duplicate role assignments
 */
describe('AssignRoleCommandHandler', () => {
  let handler: AssignRoleCommandHandler;
  let mockRoleRepository: any;
  let mockUserRoleRepository: any;
  let mockUserRepository: any;
  let mockPermissionCache: any;
  let mockAuditLog: any;
  let mockRedisPubSub: any;

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '123e4567-e89b-12d3-a456-426614174001';
  const mockRoleId = '123e4567-e89b-12d3-a456-426614174002';
  const mockAdminRoleId = '123e4567-e89b-12d3-a456-426614174003';
  const mockAssignedBy = '123e4567-e89b-12d3-a456-426614174004';

  beforeEach(async () => {
    // Create mocks
    mockRoleRepository = {
      findById: jest.fn(),
      findByName: jest.fn(),
    };

    mockUserRoleRepository = {
      findByUserIdAndRoleId: jest.fn(),
      save: jest.fn(),
      findByTenantAndRole: jest.fn(),
      countActiveAdmins: jest.fn(),
    };

    mockUserRepository = {
      findById: jest.fn(),
    };

    mockPermissionCache = {
      invalidateUser: jest.fn(),
    };

    mockAuditLog = {
      log: jest.fn(),
    };

    mockRedisPubSub = {
      publishUserInvalidation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignRoleCommandHandler,
        { provide: 'RoleRepository', useValue: mockRoleRepository },
        { provide: 'UserRoleRepository', useValue: mockUserRoleRepository },
        { provide: 'UserRepository', useValue: mockUserRepository },
        { provide: 'PermissionCacheService', useValue: mockPermissionCache },
        { provide: 'AuditLogService', useValue: mockAuditLog },
        { provide: 'RedisPubSubService', useValue: mockRedisPubSub },
      ],
    }).compile();

    handler = module.get<AssignRoleCommandHandler>(AssignRoleCommandHandler);
  });

  describe('Successful Role Assignment', () => {
    it('should assign role to user successfully', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      const mockRole = {
        id: mockRoleId,
        name: 'OPERATOR',
        tenantId: mockTenantId,
        isSystemRole: false,
      };

      const mockUser = {
        id: mockUserId,
        tenantId: mockTenantId,
      };

      mockRoleRepository.findById.mockResolvedValue(mockRole);
      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null); // No existing assignment
      mockUserRoleRepository.save.mockResolvedValue({ id: 'new-assignment-id' });

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe('new-assignment-id');
      expect(mockUserRoleRepository.save).toHaveBeenCalled();
      expect(mockPermissionCache.invalidateUser).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
      expect(mockRedisPubSub.publishUserInvalidation).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'assign_role',
          userId: mockUserId,
          roleId: mockRoleId,
        }),
      );
    });

    it('should assign role with expiration date', async () => {
      // Arrange
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90 days

      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        expiresAt,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null);
      mockUserRoleRepository.save.mockResolvedValue({ id: 'new-assignment-id', expiresAt });

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result.expiresAt).toEqual(expiresAt);
    });

    it('should assign facility-scoped role', async () => {
      // Arrange
      const facilityIds = ['facility-1', 'facility-2'];
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        facilityIds,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null);
      mockUserRoleRepository.save.mockResolvedValue({ id: 'new-assignment-id', facilityIds });

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result.facilityIds).toEqual(facilityIds);
    });
  });

  describe('Validation Errors', () => {
    it('should throw NotFoundException if role does not exist', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
      await expect(handler.execute(command)).rejects.toThrow('Role not found');
    });

    it('should throw NotFoundException if user does not exist', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
      await expect(handler.execute(command)).rejects.toThrow('User not found');
    });

    it('should throw ForbiddenException if role belongs to different tenant', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      const differentTenantRole = {
        id: mockRoleId,
        tenantId: 'different-tenant-id',
      };

      mockRoleRepository.findById.mockResolvedValue(differentTenantRole);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
      await expect(handler.execute(command)).rejects.toThrow('Cross-tenant role assignment denied');
    });

    it('should throw ForbiddenException if user belongs to different tenant', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      const differentTenantUser = {
        id: mockUserId,
        tenantId: 'different-tenant-id',
      };

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue(differentTenantUser);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
      await expect(handler.execute(command)).rejects.toThrow('Cross-tenant user assignment denied');
    });

    it('should throw error if role is already assigned', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue({
        id: 'existing-assignment-id',
      });

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow('Role is already assigned to user');
    });
  });

  describe('Last Admin Protection', () => {
    it('should prevent removing last admin when assigning different role to last admin', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId, // Non-admin role
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        replaceExisting: true, // This would remove current ADMIN role
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, name: 'OPERATOR', tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null);

      // User currently has ADMIN role and is the last admin
      mockUserRoleRepository.findByTenantAndRole.mockResolvedValue([
        { userId: mockUserId, roleId: mockAdminRoleId },
      ]);
      mockUserRoleRepository.countActiveAdmins.mockResolvedValue(1); // Last admin

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
      await expect(handler.execute(command)).rejects.toThrow(
        'Cannot remove last administrator from tenant',
      );
    });

    it('should allow assigning non-admin role if user is not last admin', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
        replaceExisting: true,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, name: 'OPERATOR', tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null);
      mockUserRoleRepository.countActiveAdmins.mockResolvedValue(3); // Multiple admins
      mockUserRoleRepository.save.mockResolvedValue({ id: 'new-assignment-id' });

      // Act
      const result = await handler.execute(command);

      // Assert
      expect(result).toBeDefined();
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate user permission cache after successful assignment', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null);
      mockUserRoleRepository.save.mockResolvedValue({ id: 'new-assignment-id' });

      // Act
      await handler.execute(command);

      // Assert
      expect(mockPermissionCache.invalidateUser).toHaveBeenCalledWith(mockTenantId, mockUserId);
      expect(mockRedisPubSub.publishUserInvalidation).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
      );
    });

    it('should not invalidate cache if assignment fails', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue(null); // Role not found

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow();
      expect(mockPermissionCache.invalidateUser).not.toHaveBeenCalled();
      expect(mockRedisPubSub.publishUserInvalidation).not.toHaveBeenCalled();
    });
  });

  describe('Audit Logging', () => {
    it('should log successful role assignment', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue({ id: mockRoleId, name: 'OPERATOR', tenantId: mockTenantId });
      mockUserRepository.findById.mockResolvedValue({ id: mockUserId, tenantId: mockTenantId });
      mockUserRoleRepository.findByUserIdAndRoleId.mockResolvedValue(null);
      mockUserRoleRepository.save.mockResolvedValue({ id: 'new-assignment-id' });

      // Act
      await handler.execute(command);

      // Assert
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'assign_role',
          tenantId: mockTenantId,
          userId: mockUserId,
          roleId: mockRoleId,
          assignedBy: mockAssignedBy,
          decision: 'ALLOW',
        }),
      );
    });

    it('should log failed role assignment with reason', async () => {
      // Arrange
      const command = new AssignRoleCommand({
        userId: mockUserId,
        roleId: mockRoleId,
        tenantId: mockTenantId,
        assignedBy: mockAssignedBy,
      });

      mockRoleRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(handler.execute(command)).rejects.toThrow();
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'assign_role',
          decision: 'DENY',
          reason: 'Role not found',
        }),
      );
    });
  });
});
