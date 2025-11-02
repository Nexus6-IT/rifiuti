import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../../../apps/backend/src/infrastructure/persistence/prisma.service';
import { JwtService } from '@nestjs/jwt';

/**
 * T099: E2E test for consultant workflow
 * Complete user journey: login → switch tenant → perform action → verify audit trail
 *
 * Workflow Steps:
 * 1. Consultant logs in with SPID (or existing session)
 * 2. Fetches list of accessible tenants (50+ clients)
 * 3. Switches context to specific client tenant
 * 4. Performs action (e.g., create FIR, view analytics)
 * 5. Verifies audit trail shows "acting as [role] for [tenant]"
 * 6. Switches back to another tenant
 * 7. Verifies data isolation
 *
 * Acceptance Criteria (from spec.md):
 * - Context switch completes in <2 seconds
 * - Audit trail clearly shows consultant context
 * - No cross-tenant data leakage at any step
 */
describe('Consultant Workflow E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const consultantEmail = 'consultant-e2e@wasteflow.it';
  const consultantUserId = 'consultant-e2e-user-id';
  const tenantClientA = 'tenant-client-a-e2e';
  const tenantClientB = 'tenant-client-b-e2e';
  const roleConsultant = 'role-consultant-e2e';

  let consultantJwt: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // Import AppModule or relevant test modules
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    await setupE2EScenario();
  });

  afterAll(async () => {
    await cleanupE2EScenario();
    await app.close();
  });

  async function setupE2EScenario() {
    // Create test tenants
    await prisma.$executeRaw`
      INSERT INTO tenants (id, name, created_at) VALUES
      (${tenantClientA}, 'Client A Waste Management', NOW()),
      (${tenantClientB}, 'Client B Waste Management', NOW())
      ON CONFLICT DO NOTHING
    `;

    // Create consultant user
    await prisma.$executeRaw`
      INSERT INTO users (id, email, tenant_id, spid_fiscal_code) VALUES
      (${consultantUserId}, ${consultantEmail}, ${tenantClientA}, 'CNSLTT99A01H501Z')
      ON CONFLICT DO NOTHING
    `;

    // Create consultant role
    await prisma.$executeRaw`
      INSERT INTO roles (id, tenant_id, name, is_system_role, description) VALUES
      (${roleConsultant}, ${tenantClientA}, 'CONSULTANT', true, 'Environmental consultant role')
      ON CONFLICT DO NOTHING
    `;

    // Associate consultant with both client tenants
    await prisma.consultantTenantAssociation.createMany({
      data: [
        {
          consultantUserId,
          tenantId: tenantClientA,
          roleId: roleConsultant,
          addedBy: 'admin-client-a',
          isActive: true,
        },
        {
          consultantUserId,
          tenantId: tenantClientB,
          roleId: roleConsultant,
          addedBy: 'admin-client-b',
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });

    // Create test data in each tenant
    await prisma.$executeRaw`
      INSERT INTO firs (id, tenant_id, status, created_by, waste_description) VALUES
      ('fir-client-a-001', ${tenantClientA}, 'DRAFT', ${consultantUserId}, 'Industrial waste batch 1'),
      ('fir-client-a-002', ${tenantClientA}, 'SUBMITTED', 'other-user-a', 'Hazardous waste'),
      ('fir-client-b-001', ${tenantClientB}, 'DRAFT', 'other-user-b', 'Organic waste'),
      ('fir-client-b-002', ${tenantClientB}, 'APPROVED', 'other-user-b', 'Electronic waste')
      ON CONFLICT DO NOTHING
    `;

    // Generate initial JWT for consultant (logged in to Client A)
    consultantJwt = await jwtService.signAsync({
      userId: consultantUserId,
      email: consultantEmail,
      tenantId: tenantClientA,
      roleId: roleConsultant,
      spidFiscalCode: 'CNSLTT99A01H501Z',
      lastSpidAuthTimestamp: Date.now(),
    });
  }

  async function cleanupE2EScenario() {
    await prisma.$executeRaw`DELETE FROM firs WHERE tenant_id IN (${tenantClientA}, ${tenantClientB})`;
    await prisma.$executeRaw`DELETE FROM consultant_tenant_associations WHERE consultant_user_id = ${consultantUserId}`;
    await prisma.$executeRaw`DELETE FROM users WHERE id = ${consultantUserId}`;
    await prisma.$executeRaw`DELETE FROM roles WHERE id = ${roleConsultant}`;
    await prisma.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantClientA}, ${tenantClientB})`;
  }

  describe('Complete Consultant Workflow', () => {
    it('should execute full workflow: login → fetch tenants → switch context → perform action → verify audit', async () => {
      // Step 1: Consultant fetches accessible tenants
      const tenantsResponse = await request(app.getHttpServer())
        .get('/api/v1/consultant/tenants')
        .set('Authorization', `Bearer ${consultantJwt}`)
        .expect(200);

      expect(tenantsResponse.body.tenants).toHaveLength(2);
      expect(tenantsResponse.body.tenants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tenantId: tenantClientA }),
          expect.objectContaining({ tenantId: tenantClientB }),
        ]),
      );

      // Step 2: Consultant views current tenant (Client A) data
      const clientAFirsResponse = await request(app.getHttpServer())
        .get('/api/v1/firs')
        .set('Authorization', `Bearer ${consultantJwt}`)
        .expect(200);

      expect(clientAFirsResponse.body.firs).toHaveLength(2);
      expect(
        clientAFirsResponse.body.firs.every((fir: any) => fir.tenantId === tenantClientA),
      ).toBe(true);

      // Step 3: Consultant switches context to Client B
      const switchStartTime = Date.now();
      const switchResponse = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwt}`)
        .send({
          targetTenantId: tenantClientB,
        })
        .expect(200);

      const switchDuration = Date.now() - switchStartTime;
      expect(switchDuration).toBeLessThan(2000); // <2s per plan.md

      const clientBJwt = switchResponse.body.newJwt;

      // Verify JWT contains Client B context
      const decoded = jwtService.decode(clientBJwt) as any;
      expect(decoded.tenantId).toBe(tenantClientB);

      // Step 4: Consultant performs action on Client B (create FIR)
      const createFirResponse = await request(app.getHttpServer())
        .post('/api/v1/firs')
        .set('Authorization', `Bearer ${clientBJwt}`)
        .send({
          wasteDescription: 'Construction debris - consultant created',
          cerCode: '17.01.07',
          quantity: 500,
          unit: 'KG',
        })
        .expect(201);

      expect(createFirResponse.body.fir.tenantId).toBe(tenantClientB);
      expect(createFirResponse.body.fir.createdBy).toBe(consultantUserId);

      const newFirId = createFirResponse.body.fir.id;

      // Step 5: Verify audit trail shows consultant acting for Client B
      const auditResponse = await request(app.getHttpServer())
        .get(`/api/v1/audit/permissions/resource/fir/${newFirId}`)
        .set('Authorization', `Bearer ${clientBJwt}`)
        .expect(200);

      const auditEntry = auditResponse.body.auditLogs[0];
      expect(auditEntry).toMatchObject({
        userId: consultantUserId,
        tenantId: tenantClientB,
        actionAttempted: 'create_fir',
        decision: 'ALLOW',
        resourceType: 'fir',
        resourceId: newFirId,
      });

      // Verify audit trail includes SPID fiscal code
      expect(auditEntry.spidFiscalCode).toBe('CNSLTT99A01H501Z');

      // Verify audit trail context shows "acting as CONSULTANT for Client B"
      expect(auditEntry.contextAttributes).toMatchObject({
        actingAs: roleConsultant,
        forTenant: tenantClientB,
        consultantMode: true,
      });

      // Step 6: Consultant switches back to Client A
      const switchBackResponse = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${clientBJwt}`)
        .send({
          targetTenantId: tenantClientA,
        })
        .expect(200);

      const clientAJwtNew = switchBackResponse.body.newJwt;

      // Step 7: Verify consultant can no longer see Client B data
      const afterSwitchFirsResponse = await request(app.getHttpServer())
        .get('/api/v1/firs')
        .set('Authorization', `Bearer ${clientAJwtNew}`)
        .expect(200);

      // Should only see Client A FIRs (not the newly created Client B FIR)
      expect(afterSwitchFirsResponse.body.firs).toHaveLength(2);
      expect(
        afterSwitchFirsResponse.body.firs.every((fir: any) => fir.tenantId === tenantClientA),
      ).toBe(true);
      expect(
        afterSwitchFirsResponse.body.firs.some((fir: any) => fir.id === newFirId),
      ).toBe(false);
    });

    it('should show aggregated dashboard for consultant managing 50+ clients', async () => {
      // This test demonstrates the aggregated dashboard feature per spec.md
      const dashboardResponse = await request(app.getHttpServer())
        .get('/api/v1/consultant/dashboard')
        .set('Authorization', `Bearer ${consultantJwt}`)
        .expect(200);

      // Verify aggregated KPIs across all accessible tenants
      expect(dashboardResponse.body).toHaveProperty('totalTenants');
      expect(dashboardResponse.body).toHaveProperty('totalPendingFirs');
      expect(dashboardResponse.body).toHaveProperty('totalMudDeadlines');
      expect(dashboardResponse.body).toHaveProperty('totalRentriSyncFailures');

      expect(dashboardResponse.body.totalTenants).toBe(2); // Client A + Client B

      // Verify KPIs are aggregated across tenants
      expect(dashboardResponse.body.pendingFirsByClient).toEqual([
        { tenantId: tenantClientA, tenantName: 'Client A Waste Management', pendingCount: 1 },
        { tenantId: tenantClientB, tenantName: 'Client B Waste Management', pendingCount: 1 },
      ]);
    });

    it('should prevent consultant from accessing non-associated tenant', async () => {
      // Create a third tenant that consultant has no association with
      const tenantClientC = 'tenant-client-c-no-access';

      await prisma.$executeRaw`
        INSERT INTO tenants (id, name) VALUES
        (${tenantClientC}, 'Client C Waste Management')
        ON CONFLICT DO NOTHING
      `;

      // Attempt to switch to non-associated tenant
      const response = await request(app.getHttpServer())
        .post('/api/v1/consultant/switch-tenant')
        .set('Authorization', `Bearer ${consultantJwt}`)
        .send({
          targetTenantId: tenantClientC,
        })
        .expect(404);

      expect(response.body.message).toContain('No active association');

      // Cleanup
      await prisma.$executeRaw`DELETE FROM tenants WHERE id = ${tenantClientC}`;
    });

    it('should support consultant managing 50+ client tenants per spec.md', async () => {
      // Simulate consultant with 55 client associations
      const manyTenants = Array.from({ length: 55 }, (_, i) => `tenant-many-${i}`);

      // Create tenants
      for (const tenantId of manyTenants) {
        await prisma.$executeRaw`
          INSERT INTO tenants (id, name) VALUES
          (${tenantId}, 'Client ${i}')
          ON CONFLICT DO NOTHING
        `;
      }

      // Associate consultant with all tenants
      await prisma.consultantTenantAssociation.createMany({
        data: manyTenants.map((tenantId) => ({
          consultantUserId,
          tenantId,
          roleId: roleConsultant,
          addedBy: 'admin-test',
          isActive: true,
        })),
        skipDuplicates: true,
      });

      // Fetch tenants list
      const tenantsResponse = await request(app.getHttpServer())
        .get('/api/v1/consultant/tenants')
        .set('Authorization', `Bearer ${consultantJwt}`)
        .expect(200);

      // Should return all 55 + original 2 = 57 tenants
      expect(tenantsResponse.body.tenants).toHaveLength(57);

      // Cleanup
      await prisma.$executeRaw`DELETE FROM consultant_tenant_associations WHERE consultant_user_id = ${consultantUserId} AND tenant_id LIKE 'tenant-many-%'`;
      await prisma.$executeRaw`DELETE FROM tenants WHERE id LIKE 'tenant-many-%'`;
    });
  });
});
