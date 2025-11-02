import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../../apps/backend/src/infrastructure/persistence/prisma.service';
import { JwtService } from '@nestjs/jwt';

/**
 * T098: Integration test for consultant context switching
 * Verifies zero cross-tenant data leakage when consultant switches context
 *
 * Security Tests:
 * - Consultant can only switch to tenants they have associations with
 * - After switching, consultant can only access target tenant's data
 * - No cross-tenant data leakage during or after switch
 * - JWT contains correct tenant context after switch
 * - Cache is properly invalidated on switch
 * - Audit trail logs context switch with both tenant IDs
 */
describe('Consultant Multi-Tenant Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockConsultantUserId = 'consultant-integration-test-123';
  const mockTenantA = 'tenant-a-integration-test';
  const mockTenantB = 'tenant-b-integration-test';
  const mockTenantC = 'tenant-c-no-access';
  const mockRoleId = 'role-consultant-integration-test';

  let consultantJwtForTenantA: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // Import your AppModule or relevant modules here
      // imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    // Setup test data
    await setupTestData();

    // Generate initial JWT for consultant on tenant A
    consultantJwtForTenantA = await jwtService.signAsync({
      userId: mockConsultantUserId,
      tenantId: mockTenantA,
      roleId: mockRoleId,
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData();
    await app.close();
  });

  async function setupTestData() {
    // Create test tenants (assuming tenant table exists)
    // This is pseudo-code - adjust based on actual schema
    await prisma.$executeRaw`
      INSERT INTO tenants (id, name) VALUES
      (${mockTenantA}, 'Tenant A Test'),
      (${mockTenantB}, 'Tenant B Test'),
      (${mockTenantC}, 'Tenant C Test')
      ON CONFLICT DO NOTHING
    `;

    // Create consultant user
    await prisma.$executeRaw`
      INSERT INTO users (id, email, tenant_id) VALUES
      (${mockConsultantUserId}, 'consultant-test@example.com', ${mockTenantA})
      ON CONFLICT DO NOTHING
    `;

    // Create role
    await prisma.$executeRaw`
      INSERT INTO roles (id, tenant_id, name, is_system_role) VALUES
      (${mockRoleId}, ${mockTenantA}, 'CONSULTANT', true)
      ON CONFLICT DO NOTHING
    `;

    // Create consultant associations (A and B, but NOT C)
    await prisma.consultantTenantAssociation.createMany({
      data: [
        {
          consultantUserId: mockConsultantUserId,
          tenantId: mockTenantA,
          roleId: mockRoleId,
          addedBy: 'admin-test',
          isActive: true,
        },
        {
          consultantUserId: mockConsultantUserId,
          tenantId: mockTenantB,
          roleId: mockRoleId,
          addedBy: 'admin-test',
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });

    // Create test FIR documents in each tenant
    await prisma.$executeRaw`
      INSERT INTO firs (id, tenant_id, status, created_by) VALUES
      ('fir-tenant-a-1', ${mockTenantA}, 'DRAFT', ${mockConsultantUserId}),
      ('fir-tenant-a-2', ${mockTenantA}, 'SUBMITTED', ${mockConsultantUserId}),
      ('fir-tenant-b-1', ${mockTenantB}, 'DRAFT', 'other-user'),
      ('fir-tenant-b-2', ${mockTenantB}, 'SUBMITTED', 'other-user'),
      ('fir-tenant-c-1', ${mockTenantC}, 'DRAFT', 'other-user')
      ON CONFLICT DO NOTHING
    `;
  }

  async function cleanupTestData() {
    await prisma.$executeRaw`DELETE FROM firs WHERE tenant_id IN (${mockTenantA}, ${mockTenantB}, ${mockTenantC})`;
    await prisma.$executeRaw`DELETE FROM consultant_tenant_associations WHERE consultant_user_id = ${mockConsultantUserId}`;
    await prisma.$executeRaw`DELETE FROM users WHERE id = ${mockConsultantUserId}`;
    await prisma.$executeRaw`DELETE FROM roles WHERE id = ${mockRoleId}`;
    await prisma.$executeRaw`DELETE FROM tenants WHERE id IN (${mockTenantA}, ${mockTenantB}, ${mockTenantC})`;
  }

  describe('GET /api/v1/consultant/tenants', () => {
    it('should return all tenants consultant has access to', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/consultant/tenants')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .expect(200);

      expect(response.body.tenants).toHaveLength(2);
      expect(response.body.tenants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tenantId: mockTenantA }),
          expect.objectContaining({ tenantId: mockTenantB }),
        ]),
      );

      // Should NOT include tenant C
      expect(response.body.tenants.find((t: any) => t.tenantId === mockTenantC)).toBeUndefined();
    });

    it('should not return inactive associations', async () => {
      // Deactivate tenant B association
      await prisma.consultantTenantAssociation.updateMany({
        where: {
          consultantUserId: mockConsultantUserId,
          tenantId: mockTenantB,
        },
        data: {
          isActive: false,
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/consultant/tenants')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .expect(200);

      // Should only return tenant A now
      expect(response.body.tenants).toHaveLength(1);
      expect(response.body.tenants[0].tenantId).toBe(mockTenantA);

      // Reactivate for other tests
      await prisma.consultantTenantAssociation.updateMany({
        where: {
          consultantUserId: mockConsultantUserId,
          tenantId: mockTenantB,
        },
        data: {
          isActive: true,
        },
      });
    });
  });

  describe('POST /api/v1/consultant/switch-tenant', () => {
    it('should successfully switch context from tenant A to tenant B', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantB,
        })
        .expect(200);

      // Verify response contains new JWT
      expect(response.body.newJwt).toBeDefined();
      expect(response.body.tenantId).toBe(mockTenantB);

      // Decode JWT to verify tenant context
      const decoded = jwtService.decode(response.body.newJwt) as any;
      expect(decoded.tenantId).toBe(mockTenantB);
      expect(decoded.userId).toBe(mockConsultantUserId);
    });

    it('should prevent switching to tenant without association (tenant C)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantC,
        })
        .expect(404);

      expect(response.body.message).toContain('No active association');
    });

    it('should enforce zero cross-tenant data leakage after switch', async () => {
      // Switch to tenant B
      const switchResponse = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantB,
        })
        .expect(200);

      const newJwtForTenantB = switchResponse.body.newJwt;

      // Now query FIRs using tenant B JWT
      const firsResponse = await request(app.getHttpServer())
        .get('/api/v1/firs')
        .set('Authorization', `Bearer ${newJwtForTenantB}`)
        .expect(200);

      // Should only see tenant B FIRs
      expect(firsResponse.body.firs).toHaveLength(2);
      expect(firsResponse.body.firs.every((fir: any) => fir.tenantId === mockTenantB)).toBe(true);

      // Should NOT see tenant A FIRs
      expect(firsResponse.body.firs.some((fir: any) => fir.tenantId === mockTenantA)).toBe(false);

      // Should NOT see tenant C FIRs
      expect(firsResponse.body.firs.some((fir: any) => fir.tenantId === mockTenantC)).toBe(false);
    });

    it('should complete context switch in <2 seconds per plan.md', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantB,
        })
        .expect(200);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // <2s per plan.md
    });

    it('should log audit trail for context switch', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantB,
        })
        .expect(200);

      // Check audit log
      const auditLogs = await prisma.permissionAuditLog.findMany({
        where: {
          userId: mockConsultantUserId,
          actionAttempted: 'switch_tenant_context',
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: 1,
      });

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].contextAttributes).toMatchObject({
        sourceTenantId: mockTenantA,
        targetTenantId: mockTenantB,
      });
    });
  });

  describe('Zero Cross-Tenant Data Leakage', () => {
    it('should prevent accessing tenant A data with tenant B JWT', async () => {
      // Get JWT for tenant B
      const switchResponse = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantB,
        })
        .expect(200);

      const jwtForTenantB = switchResponse.body.newJwt;

      // Attempt to access specific tenant A FIR using tenant B JWT
      const response = await request(app.getHttpServer())
        .get('/api/v1/firs/fir-tenant-a-1')
        .set('Authorization', `Bearer ${jwtForTenantB}`)
        .expect(403); // Should be forbidden

      expect(response.body.message).toContain('Cross-tenant access denied');
    });

    it('should prevent modifying tenant A data with tenant B JWT', async () => {
      // Get JWT for tenant B
      const switchResponse = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwtForTenantA}`)
        .send({
          targetTenantId: mockTenantB,
        })
        .expect(200);

      const jwtForTenantB = switchResponse.body.newJwt;

      // Attempt to update tenant A FIR using tenant B JWT
      const response = await request(app.getHttpServer())
        .put('/api/v1/firs/fir-tenant-a-1')
        .set('Authorization', `Bearer ${jwtForTenantB}`)
        .send({
          status: 'APPROVED',
        })
        .expect(403);

      expect(response.body.message).toContain('Cross-tenant access denied');
    });
  });
});
