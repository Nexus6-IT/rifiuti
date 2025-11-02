import { Test, TestingModule } from '@nestjs/testing';
import { GetConsultantTenantsQueryHandler } from '../../../../../apps/backend/src/application/queries/handlers/get-consultant-tenants.handler';
import { GetConsultantTenantsQuery } from '../../../../../apps/backend/src/application/queries/get-consultant-tenants.query';
import { ConsultantTenantAssociationRepository } from '../../../../../apps/backend/src/domain/identity-access/consultant-tenant-association.repository.interface';

/**
 * T097: Unit test for GetConsultantTenantsQuery handler
 * Tests retrieval of all tenants accessible by consultant
 *
 * Business Rules to Test:
 * - Returns only active and non-expired associations
 * - Orders tenants by most recently accessed
 * - Includes role information for each tenant
 * - Filters out inactive/expired associations
 * - Returns empty array if consultant has no associations
 */
describe('GetConsultantTenantsQueryHandler', () => {
  let handler: GetConsultantTenantsQueryHandler;
  let consultantAssociationRepository: jest.Mocked<ConsultantTenantAssociationRepository>;

  const mockConsultantUserId = 'consultant-123';

  const mockActiveAssociations = [
    {
      id: 'assoc-1',
      consultantUserId: mockConsultantUserId,
      tenantId: 'tenant-a',
      roleId: 'role-consultant',
      addedBy: 'admin-1',
      addedAt: new Date('2024-01-15'),
      expiresAt: null,
      isActive: true,
      isActiveAndNotExpired: () => true,
    },
    {
      id: 'assoc-2',
      consultantUserId: mockConsultantUserId,
      tenantId: 'tenant-b',
      roleId: 'role-consultant',
      addedBy: 'admin-2',
      addedAt: new Date('2024-02-20'),
      expiresAt: new Date('2025-12-31'),
      isActive: true,
      isActiveAndNotExpired: () => true,
    },
    {
      id: 'assoc-3',
      consultantUserId: mockConsultantUserId,
      tenantId: 'tenant-c',
      roleId: 'role-consultant',
      addedBy: 'admin-3',
      addedAt: new Date('2024-03-10'),
      expiresAt: null,
      isActive: false, // Inactive
      isActiveAndNotExpired: () => false,
    },
  ];

  beforeEach(async () => {
    const mockConsultantAssociationRepo = {
      findAllByConsultant: jest.fn(),
      findActiveByConsultantAndTenant: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetConsultantTenantsQueryHandler,
        {
          provide: 'ConsultantTenantAssociationRepository',
          useValue: mockConsultantAssociationRepo,
        },
      ],
    }).compile();

    handler = module.get<GetConsultantTenantsQueryHandler>(
      GetConsultantTenantsQueryHandler,
    );
    consultantAssociationRepository = module.get(
      'ConsultantTenantAssociationRepository',
    );
  });

  describe('execute', () => {
    it('should return all active tenant associations for consultant', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue(
        mockActiveAssociations as any,
      );

      const result = await handler.execute(query);

      // Verify repository called with correct consultant ID
      expect(consultantAssociationRepository.findAllByConsultant).toHaveBeenCalledWith(
        mockConsultantUserId,
      );

      // Should only return active and non-expired associations
      expect(result.tenants).toHaveLength(2); // tenant-a and tenant-b only

      // Verify structure
      expect(result.tenants[0]).toMatchObject({
        tenantId: 'tenant-a',
        roleId: 'role-consultant',
        addedAt: mockActiveAssociations[0].addedAt,
        expiresAt: null,
      });

      expect(result.tenants[1]).toMatchObject({
        tenantId: 'tenant-b',
        roleId: 'role-consultant',
        addedAt: mockActiveAssociations[1].addedAt,
        expiresAt: mockActiveAssociations[1].expiresAt,
      });
    });

    it('should return empty array if consultant has no active associations', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue([]);

      const result = await handler.execute(query);

      expect(result.tenants).toHaveLength(0);
      expect(result.tenants).toEqual([]);
    });

    it('should filter out inactive associations', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      const associations = [
        {
          ...mockActiveAssociations[0],
          isActive: false,
          isActiveAndNotExpired: () => false,
        },
        mockActiveAssociations[1],
      ];

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue(
        associations as any,
      );

      const result = await handler.execute(query);

      // Should only return tenant-b (active)
      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0].tenantId).toBe('tenant-b');
    });

    it('should filter out expired associations', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);

      const associations = [
        {
          ...mockActiveAssociations[0],
          expiresAt: pastDate,
          isActiveAndNotExpired: () => false,
        },
        mockActiveAssociations[1],
      ];

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue(
        associations as any,
      );

      const result = await handler.execute(query);

      // Should only return tenant-b (not expired)
      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0].tenantId).toBe('tenant-b');
    });

    it('should order tenants by most recently added', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      const associations = [
        {
          ...mockActiveAssociations[0],
          addedAt: new Date('2024-01-01'),
        },
        {
          ...mockActiveAssociations[1],
          tenantId: 'tenant-newest',
          addedAt: new Date('2024-03-01'),
        },
        {
          ...mockActiveAssociations[1],
          tenantId: 'tenant-middle',
          addedAt: new Date('2024-02-01'),
        },
      ];

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue(
        associations as any,
      );

      const result = await handler.execute(query);

      // Should be ordered: newest, middle, oldest
      expect(result.tenants[0].tenantId).toBe('tenant-newest');
      expect(result.tenants[1].tenantId).toBe('tenant-middle');
      expect(result.tenants[2].tenantId).toBe('tenant-a');
    });

    it('should include count of active tenants', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue(
        mockActiveAssociations as any,
      );

      const result = await handler.execute(query);

      expect(result.totalActiveAssociations).toBe(2); // Only active ones
    });

    it('should handle consultant with 50+ tenant associations per spec.md', async () => {
      const query = new GetConsultantTenantsQuery(mockConsultantUserId);

      // Generate 55 mock associations
      const manyAssociations = Array.from({ length: 55 }, (_, i) => ({
        id: `assoc-${i}`,
        consultantUserId: mockConsultantUserId,
        tenantId: `tenant-${i}`,
        roleId: 'role-consultant',
        addedBy: 'admin-1',
        addedAt: new Date(),
        expiresAt: null,
        isActive: true,
        isActiveAndNotExpired: () => true,
      }));

      consultantAssociationRepository.findAllByConsultant.mockResolvedValue(
        manyAssociations as any,
      );

      const result = await handler.execute(query);

      // Should return all 55 active associations
      expect(result.tenants).toHaveLength(55);
      expect(result.totalActiveAssociations).toBe(55);
    });
  });
});
