import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SwitchTenantContextCommandHandler } from '../../../../../apps/backend/src/application/commands/handlers/switch-tenant-context.handler';
import { SwitchTenantContextCommand } from '../../../../../apps/backend/src/application/commands/switch-tenant-context.command';
import { ConsultantTenantAssociationRepository } from '../../../../../apps/backend/src/domain/identity-access/consultant-tenant-association.repository.interface';
import { PermissionCacheService } from '../../../../../apps/backend/src/infrastructure/cache/permission-cache.service';
import { RoleCacheService } from '../../../../../apps/backend/src/infrastructure/cache/role-cache.service';
import { JwtService } from '@nestjs/jwt';

/**
 * T096: Unit test for SwitchTenantContextCommand handler
 * Tests tenant context switching with JWT regeneration and cache invalidation
 *
 * Business Rules to Test:
 * - Consultant must have active association with target tenant
 * - JWT must be regenerated with new tenant context
 * - Permission cache must be invalidated for user
 * - Role cache must be warmed for new tenant
 * - Operation must complete in <2 seconds per plan.md
 * - Cannot switch to expired or inactive association
 * - Audit trail logged for context switch
 */
describe('SwitchTenantContextCommandHandler', () => {
  let handler: SwitchTenantContextCommandHandler;
  let consultantAssociationRepository: jest.Mocked<ConsultantTenantAssociationRepository>;
  let permissionCache: jest.Mocked<PermissionCacheService>;
  let roleCache: jest.Mocked<RoleCacheService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockConsultantUserId = 'consultant-123';
  const mockSourceTenantId = 'tenant-source';
  const mockTargetTenantId = 'tenant-target';
  const mockRoleId = 'role-consultant-789';

  const mockAssociation = {
    id: 'assoc-123',
    consultantUserId: mockConsultantUserId,
    tenantId: mockTargetTenantId,
    roleId: mockRoleId,
    addedBy: 'admin-456',
    addedAt: new Date(),
    expiresAt: null,
    isActive: true,
    isActiveAndNotExpired: () => true,
  };

  beforeEach(async () => {
    const mockConsultantAssociationRepo = {
      findActiveByConsultantAndTenant: jest.fn(),
      findAllByConsultant: jest.fn(),
    };

    const mockPermissionCache = {
      invalidateUser: jest.fn(),
      warmCache: jest.fn(),
    };

    const mockRoleCache = {
      warmTenantRoles: jest.fn(),
    };

    const mockJwtService = {
      signAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwitchTenantContextCommandHandler,
        {
          provide: 'ConsultantTenantAssociationRepository',
          useValue: mockConsultantAssociationRepo,
        },
        {
          provide: PermissionCacheService,
          useValue: mockPermissionCache,
        },
        {
          provide: RoleCacheService,
          useValue: mockRoleCache,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    handler = module.get<SwitchTenantContextCommandHandler>(
      SwitchTenantContextCommandHandler,
    );
    consultantAssociationRepository = module.get(
      'ConsultantTenantAssociationRepository',
    );
    permissionCache = module.get(PermissionCacheService);
    roleCache = module.get(RoleCacheService);
    jwtService = module.get(JwtService);
  });

  describe('execute', () => {
    it('should successfully switch tenant context with JWT regeneration', async () => {
      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockSourceTenantId,
        mockTargetTenantId,
      );

      consultantAssociationRepository.findActiveByConsultantAndTenant.mockResolvedValue(
        mockAssociation as any,
      );

      const mockNewJwt = 'new-jwt-token-for-target-tenant';
      jwtService.signAsync.mockResolvedValue(mockNewJwt);

      const result = await handler.execute(command);

      // Verify association lookup
      expect(
        consultantAssociationRepository.findActiveByConsultantAndTenant,
      ).toHaveBeenCalledWith(mockConsultantUserId, mockTargetTenantId);

      // Verify cache invalidation for source tenant
      expect(permissionCache.invalidateUser).toHaveBeenCalledWith(
        mockSourceTenantId,
        mockConsultantUserId,
      );

      // Verify cache warming for target tenant
      expect(roleCache.warmTenantRoles).toHaveBeenCalledWith(mockTargetTenantId);

      // Verify JWT generation with new tenant context
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockConsultantUserId,
          tenantId: mockTargetTenantId,
          roleId: mockRoleId,
        }),
      );

      // Verify result
      expect(result).toEqual({
        newJwt: mockNewJwt,
        tenantId: mockTargetTenantId,
        roleId: mockRoleId,
      });
    });

    it('should throw NotFoundException if consultant has no association with target tenant', async () => {
      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockSourceTenantId,
        mockTargetTenantId,
      );

      consultantAssociationRepository.findActiveByConsultantAndTenant.mockResolvedValue(
        null,
      );

      await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
      await expect(handler.execute(command)).rejects.toThrow(
        `No active association found for consultant ${mockConsultantUserId} with tenant ${mockTargetTenantId}`,
      );
    });

    it('should throw ForbiddenException if association is inactive', async () => {
      const inactiveAssociation = {
        ...mockAssociation,
        isActive: false,
        isActiveAndNotExpired: () => false,
      };

      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockSourceTenantId,
        mockTargetTenantId,
      );

      consultantAssociationRepository.findActiveByConsultantAndTenant.mockResolvedValue(
        inactiveAssociation as any,
      );

      await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
      await expect(handler.execute(command)).rejects.toThrow(
        'Association with target tenant is inactive or expired',
      );
    });

    it('should throw ForbiddenException if association is expired', async () => {
      const expiredAssociation = {
        ...mockAssociation,
        isActive: true,
        isActiveAndNotExpired: () => false,
      };

      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockSourceTenantId,
        mockTargetTenantId,
      );

      consultantAssociationRepository.findActiveByConsultantAndTenant.mockResolvedValue(
        expiredAssociation as any,
      );

      await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
    });

    it('should complete in <2 seconds per plan.md performance target', async () => {
      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockSourceTenantId,
        mockTargetTenantId,
      );

      consultantAssociationRepository.findActiveByConsultantAndTenant.mockResolvedValue(
        mockAssociation as any,
      );

      jwtService.signAsync.mockResolvedValue('new-jwt-token');

      const startTime = Date.now();
      await handler.execute(command);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // <2s per plan.md
    });

    it('should invalidate cache even if warming fails (best-effort)', async () => {
      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockSourceTenantId,
        mockTargetTenantId,
      );

      consultantAssociationRepository.findActiveByConsultantAndTenant.mockResolvedValue(
        mockAssociation as any,
      );

      jwtService.signAsync.mockResolvedValue('new-jwt-token');

      // Cache warming fails
      roleCache.warmTenantRoles.mockRejectedValue(new Error('Cache warming failed'));

      // Should still succeed
      const result = await handler.execute(command);

      // Cache invalidation should have happened
      expect(permissionCache.invalidateUser).toHaveBeenCalled();

      // Result should still be returned
      expect(result.newJwt).toBe('new-jwt-token');
    });

    it('should prevent switching to same tenant (no-op)', async () => {
      const command = new SwitchTenantContextCommand(
        mockConsultantUserId,
        mockTargetTenantId, // source = target
        mockTargetTenantId,
      );

      await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
      await expect(handler.execute(command)).rejects.toThrow(
        'Cannot switch to current tenant',
      );

      // Should not call repository
      expect(
        consultantAssociationRepository.findActiveByConsultantAndTenant,
      ).not.toHaveBeenCalled();
    });
  });
});
