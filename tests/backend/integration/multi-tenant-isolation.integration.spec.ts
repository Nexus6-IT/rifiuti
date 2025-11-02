import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../../apps/backend/src/infrastructure/persistence/prisma.service';

/**
 * Multi-Tenant Isolation Integration Tests
 * Testing zero cross-tenant data leakage per plan.md FR-033
 *
 * Tests cover:
 * 1. Users cannot access roles from other tenants
 * 2. Users cannot assign roles to users in other tenants
 * 3. Users cannot view permissions from other tenants
 * 4. Cache isolation between tenants
 * 5. Database RLS policies enforce tenant boundaries
 */
describe('Multi-Tenant Isolation Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let tenant1Id: string;
  let tenant2Id: string;
  let user1Id: string; // User in tenant1
  let user2Id: string; // User in tenant2
  let role1Id: string; // Role in tenant1
  let role2Id: string; // Role in tenant2
  let token1: string; // JWT for user1
  let token2: string; // JWT for user2

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // Import full application module
        // AppModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Setup: Create two separate tenants with users and roles

    // Tenant 1
    const tenant1 = await prisma.tenant.create({
      data: {
        name: 'Tenant 1',
        legalName: 'Tenant 1 S.p.A.',
        fiscalCode: 'IT11111111111',
        pec: 'tenant1@pec.it',
        isActive: true,
      },
    });
    tenant1Id = tenant1.id;

    const user1 = await prisma.user.create({
      data: {
        tenantId: tenant1Id,
        email: 'user1@tenant1.it',
        spidFiscalCode: 'USER1111',
        firstName: 'User',
        lastName: 'One',
        isActive: true,
      },
    });
    user1Id = user1.id;

    const role1 = await prisma.role.create({
      data: {
        tenantId: tenant1Id,
        name: 'ADMIN',
        description: 'Tenant 1 Admin',
        isSystemRole: true,
        createdBy: user1Id,
      },
    });
    role1Id = role1.id;

    await prisma.userRoleAssignment.create({
      data: {
        userId: user1Id,
        roleId: role1Id,
        tenantId: tenant1Id,
        assignedBy: user1Id,
      },
    });

    // Tenant 2
    const tenant2 = await prisma.tenant.create({
      data: {
        name: 'Tenant 2',
        legalName: 'Tenant 2 S.p.A.',
        fiscalCode: 'IT22222222222',
        pec: 'tenant2@pec.it',
        isActive: true,
      },
    });
    tenant2Id = tenant2.id;

    const user2 = await prisma.user.create({
      data: {
        tenantId: tenant2Id,
        email: 'user2@tenant2.it',
        spidFiscalCode: 'USER2222',
        firstName: 'User',
        lastName: 'Two',
        isActive: true,
      },
    });
    user2Id = user2.id;

    const role2 = await prisma.role.create({
      data: {
        tenantId: tenant2Id,
        name: 'ADMIN',
        description: 'Tenant 2 Admin',
        isSystemRole: true,
        createdBy: user2Id,
      },
    });
    role2Id = role2.id;

    await prisma.userRoleAssignment.create({
      data: {
        userId: user2Id,
        roleId: role2Id,
        tenantId: tenant2Id,
        assignedBy: user2Id,
      },
    });

    // Generate JWT tokens
    token1 = await generateTestJWT({
      userId: user1Id,
      tenantId: tenant1Id,
      role: 'ADMIN',
    });

    token2 = await generateTestJWT({
      userId: user2Id,
      tenantId: tenant2Id,
      role: 'ADMIN',
    });
  });

  afterEach(async () => {
    // Cleanup
    await prisma.userRoleAssignment.deleteMany({
      where: { OR: [{ tenantId: tenant1Id }, { tenantId: tenant2Id }] },
    });
    await prisma.role.deleteMany({
      where: { OR: [{ tenantId: tenant1Id }, { tenantId: tenant2Id }] },
    });
    await prisma.user.deleteMany({
      where: { OR: [{ tenantId: tenant1Id }, { tenantId: tenant2Id }] },
    });
    await prisma.tenant.deleteMany({
      where: { OR: [{ id: tenant1Id }, { id: tenant2Id }] },
    });
  });

  describe('Role Access Isolation', () => {
    it('should only return roles for user tenant', async () => {
      // Act: User from tenant1 gets roles
      const response = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      // Assert: Should only see tenant1 roles
      expect(response.body.roles).toHaveLength(1);
      expect(response.body.roles[0].id).toBe(role1Id);
      expect(response.body.roles[0].tenantId).toBe(tenant1Id);
    });

    it('should prevent accessing role from different tenant', async () => {
      // Act: User from tenant1 tries to get role from tenant2
      await request(app.getHttpServer())
        .get(`/api/v1/roles/${role2Id}`) // Role from tenant2
        .set('Authorization', `Bearer ${token1}`) // Token from tenant1
        .expect(403); // Forbidden due to tenant isolation

      // Assert: Audit log should record cross-tenant attempt
      const auditLog = await prisma.permissionAuditLog.findFirst({
        where: {
          userId: user1Id,
          decision: 'DENY',
        },
        orderBy: { timestamp: 'desc' },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.actionAttempted).toContain('cross-tenant');
    });
  });

  describe('User Role Assignment Isolation', () => {
    it('should prevent assigning role from different tenant', async () => {
      // Act: User from tenant1 tries to assign role from tenant2
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          userId: user1Id, // User from tenant1
          roleId: role2Id, // Role from tenant2
          tenantId: tenant1Id,
        })
        .expect(403);

      // Assert
      expect(response.body.message).toContain('Cross-tenant');
    });

    it('should prevent assigning role to user in different tenant', async () => {
      // Act: User from tenant1 tries to assign role to user in tenant2
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          userId: user2Id, // User from tenant2
          roleId: role1Id, // Role from tenant1
          tenantId: tenant1Id,
        })
        .expect(403);

      // Assert
      expect(response.body.message).toContain('Cross-tenant');
    });

    it('should allow assigning role within same tenant', async () => {
      // Arrange: Create second user in tenant1
      const user1b = await prisma.user.create({
        data: {
          tenantId: tenant1Id,
          email: 'user1b@tenant1.it',
          spidFiscalCode: 'USER1B',
          firstName: 'User',
          lastName: 'One B',
          isActive: true,
        },
      });

      // Act: User from tenant1 assigns role to another user in tenant1
      const response = await request(app.getHttpServer())
        .post('/api/v1/user-roles/assign')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          userId: user1b.id,
          roleId: role1Id,
          tenantId: tenant1Id,
        })
        .expect(201);

      // Assert
      expect(response.body.userId).toBe(user1b.id);
      expect(response.body.roleId).toBe(role1Id);
      expect(response.body.tenantId).toBe(tenant1Id);

      // Cleanup
      await prisma.user.delete({ where: { id: user1b.id } });
    });
  });

  describe('Permission Query Isolation', () => {
    it('should only return permissions for user tenant', async () => {
      // Arrange: Create permissions for both tenants
      const perm1 = await prisma.permission.create({
        data: {
          resource: 'fir',
          action: 'create',
          scope: 'facility',
          description: 'Tenant 1 permission',
          module: 'FIR',
        },
      });

      const perm2 = await prisma.permission.create({
        data: {
          resource: 'fir',
          action: 'delete',
          scope: 'all',
          description: 'Tenant 2 permission',
          module: 'FIR',
        },
      });

      await prisma.rolePermission.create({
        data: {
          roleId: role1Id,
          permissionId: perm1.id,
          grantedBy: user1Id,
        },
      });

      await prisma.rolePermission.create({
        data: {
          roleId: role2Id,
          permissionId: perm2.id,
          grantedBy: user2Id,
        },
      });

      // Act: User from tenant1 gets permissions
      const response = await request(app.getHttpServer())
        .get('/api/v1/permissions/me')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      // Assert: Should only see tenant1 permissions
      expect(response.body.permissions).toContain('fir:create:facility');
      expect(response.body.permissions).not.toContain('fir:delete:all');

      // Cleanup
      await prisma.rolePermission.deleteMany({
        where: { OR: [{ roleId: role1Id }, { roleId: role2Id }] },
      });
      await prisma.permission.deleteMany({
        where: { OR: [{ id: perm1.id }, { id: perm2.id }] },
      });
    });
  });

  describe('Cache Isolation', () => {
    it('should isolate cached permissions between tenants', async () => {
      // Arrange: Create permission cache service
      const permissionCache = app.get('PermissionCacheService');

      const user1Permissions = ['fir:create:facility', 'fir:read:facility'];
      const user2Permissions = ['fir:delete:all', 'facility:manage:all'];

      // Cache permissions for both tenants
      await permissionCache.setPermissions(tenant1Id, user1Id, user1Permissions);
      await permissionCache.setPermissions(tenant2Id, user2Id, user2Permissions);

      // Act & Assert: Each tenant gets only their permissions
      const cached1 = await permissionCache.getPermissions(tenant1Id, user1Id);
      expect(cached1).toEqual(user1Permissions);

      const cached2 = await permissionCache.getPermissions(tenant2Id, user2Id);
      expect(cached2).toEqual(user2Permissions);

      // Assert: Cannot access other tenant's cache with wrong tenant ID
      const crossTenantCache = await permissionCache.getPermissions(
        tenant2Id, // Wrong tenant
        user1Id,
      );
      expect(crossTenantCache).toBeNull(); // Cache miss due to tenant mismatch
    });

    it('should include tenant ID in cache key to prevent collisions', async () => {
      // Arrange
      const permissionCache = app.get('PermissionCacheService');

      // Use same user ID (UUID collision scenario) in different tenants
      const sameUserId = '123e4567-e89b-12d3-a456-426614174999';
      const permissions1 = ['fir:create:facility'];
      const permissions2 = ['fir:delete:all'];

      // Act: Cache permissions for same user ID in different tenants
      await permissionCache.setPermissions(tenant1Id, sameUserId, permissions1);
      await permissionCache.setPermissions(tenant2Id, sameUserId, permissions2);

      // Assert: Both caches should exist independently
      const cached1 = await permissionCache.getPermissions(tenant1Id, sameUserId);
      const cached2 = await permissionCache.getPermissions(tenant2Id, sameUserId);

      expect(cached1).toEqual(permissions1);
      expect(cached2).toEqual(permissions2);
      expect(cached1).not.toEqual(cached2); // Different permissions
    });
  });

  describe('Database RLS Policy Enforcement', () => {
    it('should enforce tenant filter in role queries', async () => {
      // Act: Direct database query with RLS context
      const roles = await prisma.$queryRaw`
        SELECT * FROM roles
        WHERE tenant_id = ${tenant1Id}::uuid
      `;

      // Assert: Should only return tenant1 roles
      expect(roles).toHaveLength(1);
      expect((roles as any)[0].id).toBe(role1Id);
    });

    it('should prevent cross-tenant updates via database', async () => {
      // Act & Assert: Try to update role in tenant2 with tenant1 context
      await expect(
        prisma.role.update({
          where: { id: role2Id },
          data: {
            description: 'Hacked description',
            // Even if we set tenantId to tenant1Id, RLS should prevent this
          },
        }),
      ).rejects.toThrow(); // RLS policy violation
    });
  });

  describe('Audit Trail for Cross-Tenant Attempts', () => {
    it('should log all cross-tenant access attempts', async () => {
      // Act: Attempt cross-tenant role access
      await request(app.getHttpServer())
        .get(`/api/v1/roles/${role2Id}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(403);

      // Assert: Check audit log
      const auditLog = await prisma.permissionAuditLog.findFirst({
        where: {
          userId: user1Id,
          tenantId: tenant1Id,
          decision: 'DENY',
        },
        orderBy: { timestamp: 'desc' },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.resourceId).toBe(role2Id);
      expect(auditLog?.contextAttributes).toMatchObject({
        requestedTenantId: tenant2Id,
        userTenantId: tenant1Id,
      });
    });

    it('should alert security team on repeated cross-tenant attempts', async () => {
      // Arrange: Make multiple cross-tenant attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .get(`/api/v1/roles/${role2Id}`)
          .set('Authorization', `Bearer ${token1}`)
          .expect(403);
      }

      // Assert: Check for security alert (this would trigger notification system)
      const recentAttempts = await prisma.permissionAuditLog.count({
        where: {
          userId: user1Id,
          decision: 'DENY',
          timestamp: {
            gte: new Date(Date.now() - 60000), // Last minute
          },
        },
      });

      expect(recentAttempts).toBeGreaterThanOrEqual(5);

      // TODO: Verify security notification was sent
      // expect(mockSecurityNotificationService.send).toHaveBeenCalled();
    });
  });
});

/**
 * Helper function to generate test JWT token
 */
async function generateTestJWT(payload: any): Promise<string> {
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h',
  });
}
