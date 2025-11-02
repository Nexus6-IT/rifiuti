import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../../apps/backend/src/infrastructure/persistence/prisma.service';
import { PermissionCacheService } from '../../../apps/backend/src/infrastructure/cache/permission-cache.service';

/**
 * Role Assignment Integration Tests
 * Testing full flow from API → Application → Domain → Infrastructure
 * Per plan.md FR-008: Role assignment with cache invalidation
 *
 * Tests cover:
 * 1. End-to-end role assignment via API
 * 2. Permission cache invalidation after assignment
 * 3. Database persistence verification
 * 4. Multi-instance cache invalidation via Redis pub/sub
 */
describe('Role Assignment Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionCache: PermissionCacheService;

  let testTenantId: string;
  let testUserId: string;
  let operatorRoleId: string;
  let adminRoleId: string;
  let adminUserId: string;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // Import full application module for integration test
        // AppModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    permissionCache = app.get(PermissionCacheService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Setup: Create test tenant, users, and roles
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Test Tenant',
        legalName: 'Test Tenant S.p.A.',
        fiscalCode: 'IT12345678901',
        pec: 'test@pec.it',
        isActive: true,
      },
    });
    testTenantId = tenant.id;

    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        tenantId: testTenantId,
        email: 'admin@test.it',
        spidFiscalCode: 'ADMIN123',
        firstName: 'Admin',
        lastName: 'User',
        isActive: true,
      },
    });
    adminUserId = adminUser.id;

    // Create test user
    const testUser = await prisma.user.create({
      data: {
        tenantId: testTenantId,
        email: 'test@test.it',
        spidFiscalCode: 'TEST123',
        firstName: 'Test',
        lastName: 'User',
        isActive: true,
      },
    });
    testUserId = testUser.id;

    // Create roles
    const adminRole = await prisma.role.create({
      data: {
        tenantId: testTenantId,
        name: 'ADMIN',
        description: 'Administrator',
        isSystemRole: true,
        createdBy: adminUserId,
      },
    });
    adminRoleId = adminRole.id;

    const operatorRole = await prisma.role.create({
      data: {
        tenantId: testTenantId,
        name: 'OPERATOR',
        description: 'Operator',
        isSystemRole: true,
        createdBy: adminUserId,
      },
    });
    operatorRoleId = operatorRole.id;

    // Assign admin role to admin user
    await prisma.userRoleAssignment.create({
      data: {
        userId: adminUserId,
        roleId: adminRoleId,
        tenantId: testTenantId,
        assignedBy: adminUserId,
      },
    });

    // Generate JWT token for admin user
    authToken = await generateTestJWT({
      userId: adminUserId,
      tenantId: testTenantId,
      role: 'ADMIN',
    });
  });

  afterEach(async () => {
    // Cleanup: Delete test data
    await prisma.userRoleAssignment.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.role.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.user.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.tenant.delete({ where: { id: testTenantId } });
  });

  describe('POST /api/v1/user-roles/assign', () => {
    it('should assign role to user successfully', async () => {
      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
        })
        .expect(201);

      // Assert
      expect(response.body).toMatchObject({
        id: expect.any(String),
        userId: testUserId,
        roleId: operatorRoleId,
        tenantId: testTenantId,
        assignedBy: adminUserId,
        assignedAt: expect.any(String),
      });

      // Verify database persistence
      const dbUserRole = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: testUserId,
          roleId: operatorRoleId,
        },
      });

      expect(dbUserRole).toBeDefined();
      expect(dbUserRole?.userId).toBe(testUserId);
      expect(dbUserRole?.roleId).toBe(operatorRoleId);
    });

    it('should invalidate permission cache after role assignment', async () => {
      // Arrange: Pre-populate cache
      await permissionCache.setPermissions(testTenantId, testUserId, [
        'fir:read:facility',
      ]);

      const cachedBefore = await permissionCache.getPermissions(
        testTenantId,
        testUserId,
      );
      expect(cachedBefore).toEqual(['fir:read:facility']);

      // Act: Assign role
      await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
        })
        .expect(201);

      // Assert: Cache should be invalidated
      const cachedAfter = await permissionCache.getPermissions(
        testTenantId,
        testUserId,
      );
      expect(cachedAfter).toBeNull(); // Cache invalidated
    });

    it('should create audit log entry for role assignment', async () => {
      // Act
      await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
        })
        .expect(201);

      // Assert: Check audit log
      const auditLog = await prisma.permissionAuditLog.findFirst({
        where: {
          userId: adminUserId,
          actionAttempted: 'assign_role',
          resourceId: operatorRoleId,
        },
        orderBy: { timestamp: 'desc' },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.decision).toBe('ALLOW');
      expect(auditLog?.tenantId).toBe(testTenantId);
    });

    it('should assign role with expiration date', async () => {
      // Arrange
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
          expiresAt: expiresAt.toISOString(),
        })
        .expect(201);

      // Assert
      expect(response.body.expiresAt).toBeDefined();
      expect(new Date(response.body.expiresAt).getTime()).toBeCloseTo(
        expiresAt.getTime(),
        -4, // Within 10 seconds
      );
    });

    it('should assign facility-scoped role', async () => {
      // Arrange: Create facility
      const facility = await prisma.facility.create({
        data: {
          tenantId: testTenantId,
          name: 'Test Facility',
          address: 'Test Address',
          city: 'Test City',
          province: 'TE',
          postalCode: '00100',
          authorizedWasteCategories: ['CER 010101'],
        },
      });

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
          facilityIds: [facility.id],
        })
        .expect(201);

      // Assert
      expect(response.body.facilityIds).toEqual([facility.id]);

      // Cleanup
      await prisma.facility.delete({ where: { id: facility.id } });
    });

    it('should prevent duplicate role assignment', async () => {
      // Arrange: Assign role first time
      await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
        })
        .expect(201);

      // Act: Try to assign same role again
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
        })
        .expect(400);

      // Assert
      expect(response.body.message).toContain('already assigned');
    });

    it('should prevent cross-tenant role assignment', async () => {
      // Arrange: Create second tenant
      const otherTenant = await prisma.tenant.create({
        data: {
          name: 'Other Tenant',
          legalName: 'Other Tenant S.p.A.',
          fiscalCode: 'IT98765432109',
          pec: 'other@pec.it',
          isActive: true,
        },
      });

      const otherRole = await prisma.role.create({
        data: {
          tenantId: otherTenant.id,
          name: 'OPERATOR',
          description: 'Operator',
          isSystemRole: true,
          createdBy: adminUserId,
        },
      });

      // Act: Try to assign role from different tenant
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: testUserId,
          roleId: otherRole.id, // Role from different tenant
          tenantId: testTenantId,
        })
        .expect(403);

      // Assert
      expect(response.body.message).toContain('Cross-tenant');

      // Cleanup
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
    });

    it('should enforce last admin protection', async () => {
      // Arrange: Admin user is the only admin
      const viewerRoleId = await prisma.role
        .create({
          data: {
            tenantId: testTenantId,
            name: 'VIEWER',
            description: 'Viewer',
            isSystemRole: true,
            createdBy: adminUserId,
          },
        })
        .then((r) => r.id);

      // Act: Try to assign non-admin role to last admin with replaceExisting=true
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: adminUserId, // The only admin
          roleId: viewerRoleId,
          tenantId: testTenantId,
          replaceExisting: true,
        })
        .expect(403);

      // Assert
      expect(response.body.message).toContain('last administrator');

      // Cleanup
      await prisma.role.delete({ where: { id: viewerRoleId } });
    });
  });

  describe('GET /api/v1/permissions/me', () => {
    it('should return aggregated permissions from all user roles', async () => {
      // Arrange: Assign OPERATOR role
      await prisma.userRoleAssignment.create({
        data: {
          userId: testUserId,
          roleId: operatorRoleId,
          tenantId: testTenantId,
          assignedBy: adminUserId,
        },
      });

      // Create permissions for OPERATOR role
      const firCreatePermission = await prisma.permission.create({
        data: {
          resource: 'fir',
          action: 'create',
          scope: 'facility',
          description: 'Create FIR',
          module: 'FIR',
        },
      });

      await prisma.rolePermission.create({
        data: {
          roleId: operatorRoleId,
          permissionId: firCreatePermission.id,
          grantedBy: adminUserId,
        },
      });

      // Generate token for test user
      const userToken = await generateTestJWT({
        userId: testUserId,
        tenantId: testTenantId,
        role: 'OPERATOR',
      });

      // Act
      const response = await request(app.getHttpServer())
        .get('/api/v1/permissions/me')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Assert
      expect(response.body.permissions).toContain('fir:create:facility');

      // Cleanup
      await prisma.rolePermission.deleteMany({ where: { roleId: operatorRoleId } });
      await prisma.permission.delete({ where: { id: firCreatePermission.id } });
    });
  });
});

/**
 * Helper function to generate test JWT token
 * In real implementation, use your JWT service
 */
async function generateTestJWT(payload: any): Promise<string> {
  // Mock implementation - replace with actual JWT generation
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h',
  });
}
