import { GetUserPermissionsQueryHandler } from '../../../../../apps/backend/src/application/queries/handlers/get-user-permissions.handler';
import { GetUserPermissionsQuery } from '../../../../../apps/backend/src/application/queries/get-user-permissions.query';
import { Test, TestingModule } from '@nestjs/testing';

/**
 * GetUserPermissionsQueryHandler Unit Tests
 * Testing business rules per plan.md FR-001
 *
 * Business Rules:
 * 1. Must return union of permissions from all active user roles
 * 2. Must include temporary permissions if active
 * 3. Must cache permissions with HMAC signing
 * 4. Must exclude permissions from expired/revoked roles
 * 5. Must respect facility scoping
 */
describe('GetUserPermissionsQueryHandler', () => {
  let handler: GetUserPermissionsQueryHandler;
  let mockUserRoleRepository: any;
  let mockRoleRepository: any;
  let mockTempPermissionRepository: any;
  let mockPermissionCache: any;

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUserId = '123e4567-e89b-12d3-a456-426614174001';
  const mockOperatorRoleId = '123e4567-e89b-12d3-a456-426614174002';
  const mockViewerRoleId = '123e4567-e89b-12d3-a456-426614174003';

  beforeEach(async () => {
    // Create mocks
    mockUserRoleRepository = {
      findActiveByUserId: jest.fn(),
    };

    mockRoleRepository = {
      findByIdWithPermissions: jest.fn(),
    };

    mockTempPermissionRepository = {
      findActiveByUserId: jest.fn(),
    };

    mockPermissionCache = {
      getPermissions: jest.fn(),
      setPermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetUserPermissionsQueryHandler,
        { provide: 'UserRoleRepository', useValue: mockUserRoleRepository },
        { provide: 'RoleRepository', useValue: mockRoleRepository },
        {
          provide: 'TempPermissionRepository',
          useValue: mockTempPermissionRepository,
        },
        { provide: 'PermissionCacheService', useValue: mockPermissionCache },
      ],
    }).compile();

    handler = module.get<GetUserPermissionsQueryHandler>(
      GetUserPermissionsQueryHandler,
    );
  });

  describe('Cache Hit', () => {
    it('should return permissions from cache if available', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      const cachedPermissions = [
        'fir:create:facility',
        'fir:read:facility',
        'facility:read:own',
      ];

      mockPermissionCache.getPermissions.mockResolvedValue(cachedPermissions);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toEqual(cachedPermissions);
      expect(result.source).toBe('cache');
      expect(mockUserRoleRepository.findActiveByUserId).not.toHaveBeenCalled();
    });

    it('should log cache hit', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(['fir:read:facility']);

      const loggerSpy = jest.spyOn((handler as any).logger, 'debug');

      // Act
      await handler.execute(query);

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cache hit for user'),
      );
    });
  });

  describe('Cache Miss - Database Lookup', () => {
    it('should fetch permissions from database on cache miss', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null); // Cache miss

      const mockUserRoles = [
        { roleId: mockOperatorRoleId, facilityIds: null },
      ];

      const mockOperatorRole = {
        id: mockOperatorRoleId,
        name: 'OPERATOR',
        permissions: [
          'fir:create:facility',
          'fir:read:facility',
          'fir:update:facility',
        ],
      };

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions.mockResolvedValue(mockOperatorRole);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toEqual([
        'fir:create:facility',
        'fir:read:facility',
        'fir:update:facility',
      ]);
      expect(result.source).toBe('database');
      expect(mockPermissionCache.setPermissions).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        expect.arrayContaining(['fir:create:facility']),
      );
    });

    it('should return empty array if user has no roles', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);
      mockUserRoleRepository.findActiveByUserId.mockResolvedValue([]);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toEqual([]);
      expect(result.source).toBe('database');
    });
  });

  describe('Multiple Roles - Permission Union', () => {
    it('should return union of permissions from multiple roles', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [
        { roleId: mockOperatorRoleId, facilityIds: null },
        { roleId: mockViewerRoleId, facilityIds: null },
      ];

      const mockOperatorRole = {
        id: mockOperatorRoleId,
        permissions: ['fir:create:facility', 'fir:update:facility'],
      };

      const mockViewerRole = {
        id: mockViewerRoleId,
        permissions: ['fir:read:all', 'facility:read:all'],
      };

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions
        .mockResolvedValueOnce(mockOperatorRole)
        .mockResolvedValueOnce(mockViewerRole);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toHaveLength(4);
      expect(result.permissions).toContain('fir:create:facility');
      expect(result.permissions).toContain('fir:update:facility');
      expect(result.permissions).toContain('fir:read:all');
      expect(result.permissions).toContain('facility:read:all');
    });

    it('should deduplicate permissions from multiple roles', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [
        { roleId: mockOperatorRoleId, facilityIds: null },
        { roleId: mockViewerRoleId, facilityIds: null },
      ];

      const mockOperatorRole = {
        id: mockOperatorRoleId,
        permissions: ['fir:read:facility', 'fir:create:facility'],
      };

      const mockViewerRole = {
        id: mockViewerRoleId,
        permissions: ['fir:read:facility'], // Duplicate
      };

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions
        .mockResolvedValueOnce(mockOperatorRole)
        .mockResolvedValueOnce(mockViewerRole);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toHaveLength(2); // Deduplicated
      expect(result.permissions).toContain('fir:read:facility');
      expect(result.permissions).toContain('fir:create:facility');
    });
  });

  describe('Temporary Permissions', () => {
    it('should include active temporary permissions', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
        includeTempPermissions: true,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [{ roleId: mockOperatorRoleId, facilityIds: null }];

      const mockOperatorRole = {
        id: mockOperatorRoleId,
        permissions: ['fir:read:facility'],
      };

      const mockTempPermissions = [
        {
          permissions: ['fir:delete:facility', 'fir:approve:facility'],
          isActive: true,
        },
      ];

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions.mockResolvedValue(mockOperatorRole);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue(
        mockTempPermissions,
      );

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toHaveLength(3);
      expect(result.permissions).toContain('fir:read:facility');
      expect(result.permissions).toContain('fir:delete:facility');
      expect(result.permissions).toContain('fir:approve:facility');
    });

    it('should exclude temporary permissions if not requested', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
        includeTempPermissions: false,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [{ roleId: mockOperatorRoleId, facilityIds: null }];

      const mockOperatorRole = {
        id: mockOperatorRoleId,
        permissions: ['fir:read:facility'],
      };

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions.mockResolvedValue(mockOperatorRole);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions).toContain('fir:read:facility');
      expect(mockTempPermissionRepository.findActiveByUserId).not.toHaveBeenCalled();
    });
  });

  describe('Facility Scoping', () => {
    it('should include facility IDs for facility-scoped roles', async () => {
      // Arrange
      const facilityId = 'facility-123';
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [
        { roleId: mockOperatorRoleId, facilityIds: [facilityId] },
      ];

      const mockOperatorRole = {
        id: mockOperatorRoleId,
        permissions: ['fir:create:facility'],
      };

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions.mockResolvedValue(mockOperatorRole);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.facilityIds).toContain(facilityId);
    });

    it('should merge facility IDs from multiple roles', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [
        { roleId: mockOperatorRoleId, facilityIds: ['facility-1', 'facility-2'] },
        { roleId: mockViewerRoleId, facilityIds: ['facility-2', 'facility-3'] },
      ];

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions
        .mockResolvedValueOnce({ permissions: ['fir:create:facility'] })
        .mockResolvedValueOnce({ permissions: ['fir:read:facility'] });
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      const result = await handler.execute(query);

      // Assert
      expect(result.facilityIds).toHaveLength(3);
      expect(result.facilityIds).toContain('facility-1');
      expect(result.facilityIds).toContain('facility-2');
      expect(result.facilityIds).toContain('facility-3');
    });
  });

  describe('Performance', () => {
    it('should complete within performance target (<10ms with cache hit)', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue([
        'fir:read:facility',
      ]);

      // Act
      const startTime = Date.now();
      await handler.execute(query);
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(10); // P99 target: <10ms
    });

    it('should cache permissions after database fetch', async () => {
      // Arrange
      const query = new GetUserPermissionsQuery({
        userId: mockUserId,
        tenantId: mockTenantId,
      });

      mockPermissionCache.getPermissions.mockResolvedValue(null);

      const mockUserRoles = [{ roleId: mockOperatorRoleId }];
      const mockRole = { permissions: ['fir:read:facility'] };

      mockUserRoleRepository.findActiveByUserId.mockResolvedValue(mockUserRoles);
      mockRoleRepository.findByIdWithPermissions.mockResolvedValue(mockRole);
      mockTempPermissionRepository.findActiveByUserId.mockResolvedValue([]);

      // Act
      await handler.execute(query);

      // Assert
      expect(mockPermissionCache.setPermissions).toHaveBeenCalledWith(
        mockTenantId,
        mockUserId,
        ['fir:read:facility'],
        300, // 5 minutes TTL
      );
    });
  });
});
