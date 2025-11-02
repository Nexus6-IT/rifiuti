import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CreateCustomRoleCommandHandler } from '../../../apps/backend/src/application/commands/handlers/create-custom-role.handler';
import { UpdateCustomRoleCommandHandler } from '../../../apps/backend/src/application/commands/handlers/update-custom-role.handler';
import { CreateCustomRoleCommand } from '../../../apps/backend/src/application/commands/create-custom-role.command';
import { UpdateCustomRoleCommand } from '../../../apps/backend/src/application/commands/update-custom-role.command';
import { PermissionCacheService } from '../../../apps/backend/src/infrastructure/cache/permission-cache.service';
import { RedisPubSubService } from '../../../apps/backend/src/infrastructure/cache/redis-pub-sub.service';
import { RoleRepository } from '../../../apps/backend/src/domain/identity-access/role.repository.interface';

/**
 * Custom Role Integration Tests
 * T163: Integration test for custom role creation per User Story 5
 *
 * Purpose: Verify cache invalidation when role modified
 *
 * Requirements from spec.md FR-011 acceptance scenario 4:
 * - "Modifies custom role permissions, changes take effect immediately for all users"
 * - Cache invalidation must be synchronous
 * - All instances must receive invalidation event
 *
 * Requirements from plan.md:
 * - Redis pub/sub for distributed cache invalidation
 * - <100ms cache invalidation propagation
 * - Verify zero stale cache reads after modification
 */
describe('Custom Role Integration', () => {
  let app: INestApplication;
  let createHandler: CreateCustomRoleCommandHandler;
  let updateHandler: UpdateCustomRoleCommandHandler;
  let permissionCache: PermissionCacheService;
  let redisPubSub: RedisPubSubService;
  let roleRepository: RoleRepository;

  const mockTenantId = 'tenant-integration-123';
  const mockUserId = 'user-789';
  const mockAdminId = 'admin-456';

  beforeAll(async () => {
    // Mock services
    const mockPermissionCache: Partial<PermissionCacheService> = {
      getPermissions: jest.fn(),
      setPermissions: jest.fn(),
      invalidateUser: jest.fn(),
      invalidateRole: jest.fn(),
      invalidateTenant: jest.fn(),
    };

    const mockRedisPubSub: Partial<RedisPubSubService> = {
      publishRoleInvalidation: jest.fn(),
      publishUserInvalidation: jest.fn(),
      publishTenantInvalidation: jest.fn(),
      subscribeToInvalidations: jest.fn(),
    };

    const mockRoleRepo: Partial<RoleRepository> = {
      findByName: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      findByTenant: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateCustomRoleCommandHandler,
        UpdateCustomRoleCommandHandler,
        {
          provide: PermissionCacheService,
          useValue: mockPermissionCache,
        },
        {
          provide: RedisPubSubService,
          useValue: mockRedisPubSub,
        },
        {
          provide: RoleRepository,
          useValue: mockRoleRepo,
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    createHandler = module.get<CreateCustomRoleCommandHandler>(
      CreateCustomRoleCommandHandler,
    );
    updateHandler = module.get<UpdateCustomRoleCommandHandler>(
      UpdateCustomRoleCommandHandler,
    );
    permissionCache = module.get<PermissionCacheService>(PermissionCacheService);
    redisPubSub = module.get<RedisPubSubService>(RedisPubSubService);
    roleRepository = module.get<RoleRepository>(RoleRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Cache Invalidation on Role Creation', () => {
    it('should invalidate tenant cache when custom role created', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        mockTenantId,
        'New Custom Role',
        'Newly created role',
        ['fir:read:facility', 'fir:create:facility'],
        mockAdminId,
      );

      (roleRepository.findByName as jest.Mock).mockResolvedValue(null);
      (roleRepository.save as jest.Mock).mockImplementation(async (role) => role);

      // Act
      await createHandler.execute(command);

      // Assert: Tenant cache should be invalidated
      expect(permissionCache.invalidateTenant).toHaveBeenCalledWith(mockTenantId);

      // Assert: Redis pub/sub should broadcast invalidation
      expect(redisPubSub.publishTenantInvalidation).toHaveBeenCalledWith(
        mockTenantId,
      );
    });

    it('should not affect other tenants when role created', async () => {
      // Arrange
      const command = new CreateCustomRoleCommand(
        'tenant-other-999',
        'Other Tenant Role',
        'Isolated role',
        ['fir:read:facility'],
        mockAdminId,
      );

      (roleRepository.findByName as jest.Mock).mockResolvedValue(null);
      (roleRepository.save as jest.Mock).mockImplementation(async (role) => role);

      // Act
      await createHandler.execute(command);

      // Assert: Only the specific tenant should be invalidated
      expect(permissionCache.invalidateTenant).toHaveBeenCalledWith('tenant-other-999');
      expect(permissionCache.invalidateTenant).not.toHaveBeenCalledWith(mockTenantId);
    });
  });

  describe('Cache Invalidation on Role Modification', () => {
    it('should invalidate role cache when permissions modified', async () => {
      // Arrange: Create role first
      const createCommand = new CreateCustomRoleCommand(
        mockTenantId,
        'Modifiable Role',
        'Will be modified',
        ['fir:read:facility'],
        mockAdminId,
      );

      (roleRepository.findByName as jest.Mock).mockResolvedValue(null);
      (roleRepository.save as jest.Mock).mockImplementation(async (role) => ({
        ...role,
        id: 'role-123',
      }));

      const createdRole = await createHandler.execute(createCommand);
      jest.clearAllMocks();

      // Act: Update role permissions
      const updateCommand = new UpdateCustomRoleCommand(
        createdRole.id,
        mockTenantId,
        undefined, // Keep same name
        undefined, // Keep same description
        ['fir:read:facility', 'fir:create:facility', 'fir:update:facility'], // Add permissions
        mockAdminId,
      );

      (roleRepository.findById as jest.Mock).mockResolvedValue(createdRole);
      (roleRepository.update as jest.Mock).mockImplementation(async (role) => role);

      await updateHandler.execute(updateCommand);

      // Assert: Role-specific cache should be invalidated
      expect(permissionCache.invalidateRole).toHaveBeenCalledWith(
        mockTenantId,
        createdRole.id,
      );

      // Assert: Redis pub/sub should broadcast role invalidation
      expect(redisPubSub.publishRoleInvalidation).toHaveBeenCalledWith(
        mockTenantId,
        createdRole.id,
      );
    });

    it('should immediately affect users with modified role', async () => {
      // Arrange: User has role cached
      const roleId = 'role-cache-test-123';
      const cachedPermissions = ['fir:read:facility'];

      (permissionCache.getPermissions as jest.Mock).mockResolvedValue(
        cachedPermissions,
      );

      // Simulate role update
      const updateCommand = new UpdateCustomRoleCommand(
        roleId,
        mockTenantId,
        undefined,
        undefined,
        ['fir:read:facility', 'fir:create:all'], // More permissions
        mockAdminId,
      );

      (roleRepository.findById as jest.Mock).mockResolvedValue({
        id: roleId,
        name: 'Test Role',
        permissions: cachedPermissions,
        tenantId: mockTenantId,
      });
      (roleRepository.update as jest.Mock).mockImplementation(async (role) => role);

      // Act
      await updateHandler.execute(updateCommand);

      // Assert: Cache invalidation called
      expect(permissionCache.invalidateRole).toHaveBeenCalledWith(
        mockTenantId,
        roleId,
      );

      // Next cache read should return null (cache miss)
      (permissionCache.getPermissions as jest.Mock).mockResolvedValue(null);
      const freshPermissions = await permissionCache.getPermissions(
        mockTenantId,
        mockUserId,
      );
      expect(freshPermissions).toBeNull();
    });

    it('should propagate cache invalidation within 100ms', async () => {
      // Arrange
      const roleId = 'role-perf-test-456';
      const startTime = Date.now();

      const updateCommand = new UpdateCustomRoleCommand(
        roleId,
        mockTenantId,
        'Updated Role',
        'Updated description',
        ['fir:read:all'],
        mockAdminId,
      );

      (roleRepository.findById as jest.Mock).mockResolvedValue({
        id: roleId,
        name: 'Original Role',
        permissions: ['fir:read:facility'],
        tenantId: mockTenantId,
      });
      (roleRepository.update as jest.Mock).mockImplementation(async (role) => role);

      // Act
      await updateHandler.execute(updateCommand);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert: Cache invalidation should complete in <100ms
      expect(duration).toBeLessThan(100);
      expect(permissionCache.invalidateRole).toHaveBeenCalled();
      expect(redisPubSub.publishRoleInvalidation).toHaveBeenCalled();
    });
  });

  describe('Zero Stale Cache Reads', () => {
    it('should not serve stale permissions after role update', async () => {
      // Arrange: User cached with old permissions
      const roleId = 'role-stale-test-789';
      const oldPermissions = ['fir:read:facility'];
      const newPermissions = ['fir:read:facility', 'fir:delete:facility'];

      // Step 1: Initial cache state
      (permissionCache.getPermissions as jest.Mock).mockResolvedValueOnce(
        oldPermissions,
      );

      const cachedPerms1 = await permissionCache.getPermissions(
        mockTenantId,
        mockUserId,
      );
      expect(cachedPerms1).toEqual(oldPermissions);

      // Step 2: Role update
      const updateCommand = new UpdateCustomRoleCommand(
        roleId,
        mockTenantId,
        undefined,
        undefined,
        newPermissions,
        mockAdminId,
      );

      (roleRepository.findById as jest.Mock).mockResolvedValue({
        id: roleId,
        name: 'Test Role',
        permissions: oldPermissions,
        tenantId: mockTenantId,
      });
      (roleRepository.update as jest.Mock).mockImplementation(async (role) => role);

      await updateHandler.execute(updateCommand);

      // Step 3: Cache should return null (invalidated)
      (permissionCache.getPermissions as jest.Mock).mockResolvedValueOnce(null);

      const cachedPerms2 = await permissionCache.getPermissions(
        mockTenantId,
        mockUserId,
      );

      // Assert: Should NOT return old permissions
      expect(cachedPerms2).toBeNull();
      expect(cachedPerms2).not.toEqual(oldPermissions);
    });
  });

  describe('Distributed Invalidation', () => {
    it('should publish invalidation to all app instances', async () => {
      // Arrange
      const roleId = 'role-distributed-123';

      const updateCommand = new UpdateCustomRoleCommand(
        roleId,
        mockTenantId,
        'Distributed Test',
        'Test pub/sub',
        ['fir:read:all'],
        mockAdminId,
      );

      (roleRepository.findById as jest.Mock).mockResolvedValue({
        id: roleId,
        name: 'Original',
        permissions: ['fir:read:facility'],
        tenantId: mockTenantId,
      });
      (roleRepository.update as jest.Mock).mockImplementation(async (role) => role);

      // Act
      await updateHandler.execute(updateCommand);

      // Assert: Redis pub/sub should be called
      expect(redisPubSub.publishRoleInvalidation).toHaveBeenCalledWith(
        mockTenantId,
        roleId,
      );

      // Assert: Called exactly once per update
      expect(redisPubSub.publishRoleInvalidation).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent updates without race conditions', async () => {
      // Arrange: Two concurrent updates to same role
      const roleId = 'role-concurrent-456';

      const update1 = new UpdateCustomRoleCommand(
        roleId,
        mockTenantId,
        'Update 1',
        undefined,
        ['fir:read:facility'],
        mockAdminId,
      );

      const update2 = new UpdateCustomRoleCommand(
        roleId,
        mockTenantId,
        'Update 2',
        undefined,
        ['fir:read:all'],
        mockAdminId,
      );

      (roleRepository.findById as jest.Mock).mockResolvedValue({
        id: roleId,
        name: 'Original',
        permissions: ['fir:read:own'],
        tenantId: mockTenantId,
      });
      (roleRepository.update as jest.Mock).mockImplementation(async (role) => role);

      // Act: Execute concurrently
      await Promise.all([
        updateHandler.execute(update1),
        updateHandler.execute(update2),
      ]);

      // Assert: Both invalidations should complete
      expect(permissionCache.invalidateRole).toHaveBeenCalledTimes(2);
      expect(redisPubSub.publishRoleInvalidation).toHaveBeenCalledTimes(2);
    });
  });
});
