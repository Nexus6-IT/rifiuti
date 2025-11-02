import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { TestDataSeeder, getTestPrismaClient } from './helpers/seed-test-data';

/**
 * E2E Tests for RENTRI Sync Workflow
 *
 * Tests complete workflow:
 * 1. Create FIR
 * 2. Complete FIR workflow with all signatures
 * 3. Trigger RENTRI sync (automatic or manual)
 * 4. Verify FIR synced to RENTRI mock API
 * 5. Check sync status and logs
 *
 * Uses real database (testcontainers) and RENTRI mock API.
 */
describe('RENTRI Sync E2E', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let seeder: TestDataSeeder;
  let authToken: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    // Setup test database
    prisma = getTestPrismaClient();
    seeder = new TestDataSeeder(prisma);

    // Create test module
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // Import your AppModule here
        // AppModule
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Seed test tenant and user
    const tenant = await seeder.createTestTenant();
    tenantId = tenant.id;

    const user = await seeder.createTestUser(tenantId, {
      role: 'ADMIN',
    });
    userId = user.id;

    // Get auth token (mock Keycloak for tests)
    authToken = await getTestAuthToken(userId, tenantId, 'ADMIN');
  });

  afterAll(async () => {
    await seeder.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('Automatic RENTRI Sync Workflow', () => {
    it('should automatically sync FIR to RENTRI within 5 minutes after completion', async () => {
      // Step 1: Create FIR
      const createResponse = await request(app.getHttpServer())
        .post('/v1/fir')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          producerName: 'Test Producer SRL',
          producerPartitaIva: '12345678901',
          producerAddress: 'Via Producer 1, Milano',
          carrierName: 'Test Carrier SRL',
          carrierPartitaIva: '98765432109',
          carrierVehiclePlate: 'AB123CD',
          receiverName: 'Test Receiver SRL',
          receiverPartitaIva: '11223344556',
          receiverAddress: 'Via Receiver 1, Roma',
          cerCode: '150102',
          wasteDescription: 'Plastic packaging',
          wasteCategory: 'NON PERICOLOSO',
          quantity: 100,
          unit: 'KG',
          transportDate: new Date().toISOString(),
        })
        .expect(201);

      const firId = createResponse.body.id;

      // Step 2: Complete FIR workflow (sign by all parties)
      // Producer signature
      await request(app.getHttpServer())
        .post(`/v1/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          role: 'PRODUCER',
          signatureValue: 'producer-signature-base64',
        })
        .expect(200);

      // Carrier signature
      await request(app.getHttpServer())
        .post(`/v1/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          role: 'CARRIER',
          signatureValue: 'carrier-signature-base64',
        })
        .expect(200);

      // Receiver signature (final - triggers completion)
      await request(app.getHttpServer())
        .post(`/v1/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          role: 'RECEIVER',
          signatureValue: 'receiver-signature-base64',
        })
        .expect(200);

      // Step 3: Verify FIR status is COMPLETED
      const statusResponse = await request(app.getHttpServer())
        .get(`/v1/fir/${firId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.status).toBe('COMPLETED');
      expect(statusResponse.body.rentriSyncStatus).toBe('PENDING');

      // Step 4: Wait for automatic RENTRI sync (background job)
      // In real scenario, this would be triggered by event handler
      // For test, we trigger manually or wait for queue processing
      await waitForCondition(
        async () => {
          const fir = await prisma.fIR.findUnique({
            where: { id: firId },
          });
          return fir?.rentriSyncStatus === 'SYNCED';
        },
        5 * 60 * 1000, // 5 minutes timeout
        5000, // Check every 5 seconds
      );

      // Step 5: Verify FIR synced to RENTRI
      const syncedFIR = await prisma.fIR.findUnique({
        where: { id: firId },
      });

      expect(syncedFIR.rentriSyncStatus).toBe('SYNCED');
      expect(syncedFIR.rentriProtocolNumber).toBeDefined();
      expect(syncedFIR.rentriSyncedAt).toBeDefined();

      // Step 6: Verify in RENTRI mock API
      const rentriResponse = await request('http://localhost:3001')
        .get(`/api/v1/fir/${firId}`)
        .expect(200);

      expect(rentriResponse.body.firId).toBe(firId);
      expect(rentriResponse.body.status).toBe('ACCEPTED');
      expect(rentriResponse.body.protocolNumber).toBe(syncedFIR.rentriProtocolNumber);

      // Step 7: Check sync logs
      const logsResponse = await request(app.getHttpServer())
        .get('/v1/rentri/sync/logs')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ firId })
        .expect(200);

      expect(logsResponse.body.data).toHaveLength(1);
      expect(logsResponse.body.data[0].status).toBe('SUCCESS');
    }, 10 * 60 * 1000); // 10 minute test timeout
  });

  describe('Manual RENTRI Sync', () => {
    it('should manually sync completed FIR to RENTRI', async () => {
      // Create and complete FIR
      const fir = await seeder.createTestFIR(tenantId, userId, {
        status: 'COMPLETED',
        rentriSyncStatus: 'PENDING',
      });

      // Manually trigger sync
      const syncResponse = await request(app.getHttpServer())
        .post(`/v1/rentri/sync/fir/${fir.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(202); // Accepted - queued for processing

      const jobId = syncResponse.body.jobId;

      // Wait for job completion
      await waitForCondition(
        async () => {
          const statusResponse = await request(app.getHttpServer())
            .get(`/v1/rentri/sync/status/${jobId}`)
            .set('Authorization', `Bearer ${authToken}`);

          return statusResponse.body.status === 'completed';
        },
        60000, // 1 minute
        2000, // Check every 2 seconds
      );

      // Verify sync completed
      const finalStatus = await request(app.getHttpServer())
        .get(`/v1/rentri/sync/status/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(finalStatus.body.status).toBe('completed');
      expect(finalStatus.body.result.success).toBe(true);
      expect(finalStatus.body.result.protocolNumber).toBeDefined();
    });

    it('should handle sync failure with retry', async () => {
      // Create FIR with invalid data
      const fir = await seeder.createTestFIR(tenantId, userId, {
        status: 'COMPLETED',
        cerCode: 'INVALID', // Will fail RENTRI validation
        rentriSyncStatus: 'PENDING',
      });

      // Trigger sync
      const syncResponse = await request(app.getHttpServer())
        .post(`/v1/rentri/sync/fir/${fir.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(202);

      const jobId = syncResponse.body.jobId;

      // Wait for job to fail
      await waitForCondition(
        async () => {
          const statusResponse = await request(app.getHttpServer())
            .get(`/v1/rentri/sync/status/${jobId}`)
            .set('Authorization', `Bearer ${authToken}`);

          return statusResponse.body.status === 'failed';
        },
        30000,
        2000,
      );

      // Verify failure status
      const finalStatus = await request(app.getHttpServer())
        .get(`/v1/rentri/sync/status/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(finalStatus.body.status).toBe('failed');
      expect(finalStatus.body.failedReason).toContain('validation');
    });
  });

  describe('Batch RENTRI Sync', () => {
    it('should batch sync multiple FIRs to RENTRI', async () => {
      // Create multiple completed FIRs
      const fir1 = await seeder.createTestFIR(tenantId, userId, { status: 'COMPLETED' });
      const fir2 = await seeder.createTestFIR(tenantId, userId, { status: 'COMPLETED' });
      const fir3 = await seeder.createTestFIR(tenantId, userId, { status: 'COMPLETED' });

      // Trigger batch sync
      const batchResponse = await request(app.getHttpServer())
        .post('/v1/rentri/sync/batch')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firIds: [fir1.id, fir2.id, fir3.id],
        })
        .expect(202);

      const batchJobId = batchResponse.body.jobId;

      // Wait for batch completion
      await waitForCondition(
        async () => {
          const statusResponse = await request(app.getHttpServer())
            .get(`/v1/rentri/sync/status/${batchJobId}`)
            .set('Authorization', `Bearer ${authToken}`);

          return statusResponse.body.status === 'completed';
        },
        120000, // 2 minutes
        5000,
      );

      // Verify all FIRs synced
      const fir1Synced = await prisma.fIR.findUnique({ where: { id: fir1.id } });
      const fir2Synced = await prisma.fIR.findUnique({ where: { id: fir2.id } });
      const fir3Synced = await prisma.fIR.findUnique({ where: { id: fir3.id } });

      expect(fir1Synced.rentriSyncStatus).toBe('SYNCED');
      expect(fir2Synced.rentriSyncStatus).toBe('SYNCED');
      expect(fir3Synced.rentriSyncStatus).toBe('SYNCED');
    });
  });
});

/**
 * Helper: Wait for condition with timeout
 */
async function waitForCondition(
  condition: () => Promise<boolean>,
  timeout: number,
  interval: number,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error('Condition timeout exceeded');
}

/**
 * Helper: Get test auth token (mock)
 */
async function getTestAuthToken(userId: string, tenantId: string, role: string): Promise<string> {
  // In real tests, this would interact with Keycloak or use a mock JWT
  // For now, return a mock token
  return `test-token-${userId}-${tenantId}-${role}`;
}
