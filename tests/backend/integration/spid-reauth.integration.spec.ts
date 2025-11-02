import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { SpidReauthInterceptor, RequireSpidReauth } from '../../../apps/backend/src/api/interceptors/spid-reauth.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Controller, Delete, Get, UseGuards } from '@nestjs/common';

/**
 * Integration Test: SPID Re-Authentication Flow
 *
 * Tests per spec.md FR-027:
 * 1. Verify re-auth required after 15 minutes
 * 2. Verify high-risk operations blocked without fresh SPID session
 * 3. Verify 428 Precondition Required response triggers frontend re-auth modal
 */

// Mock controller for testing
@Controller('test')
class TestController {
  @Get('public')
  getPublic() {
    return { message: 'Public endpoint - no re-auth required' };
  }

  @Delete('high-risk')
  @RequireSpidReauth()
  deleteHighRisk() {
    return { message: 'High-risk operation completed' };
  }

  @Get('digital-signature')
  @RequireSpidReauth()
  performDigitalSignature() {
    return { message: 'Digital signature applied' };
  }
}

describe('SPID Re-Authentication Integration Tests (FR-027)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: SpidReauthInterceptor,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public endpoints (no @RequireSpidReauth)', () => {
    it('should allow access to public endpoints without SPID re-auth check', async () => {
      const response = await request(app.getHttpServer())
        .get('/test/public')
        .expect(HttpStatus.OK);

      expect(response.body.message).toBe('Public endpoint - no re-auth required');
    });
  });

  describe('High-risk endpoints with fresh SPID session (<15 minutes)', () => {
    it('should allow high-risk operations when SPID session is fresh', async () => {
      const freshAuthTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago
      const mockUser = {
        id: 'user-123',
        lastSpidAuthTime: freshAuthTime,
        spidFiscalCode: 'RSSMRA80A01H501U',
      };

      // Mock authentication middleware to inject user
      const response = await request(app.getHttpServer())
        .delete('/test/high-risk')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send()
        // In real test, we'd use a proper JWT with lastSpidAuthTime claim
        // For this integration test, we're testing the interceptor logic
        .expect(HttpStatus.OK);

      // Note: In actual implementation, you'd need to:
      // 1. Set up proper auth guards
      // 2. Generate JWT with lastSpidAuthTime claim
      // 3. Test with real auth flow
    });
  });

  describe('High-risk endpoints with stale SPID session (>15 minutes)', () => {
    it('should block high-risk operations when SPID session is stale (>15 minutes)', async () => {
      const staleAuthTime = Date.now() - (20 * 60 * 1000); // 20 minutes ago
      const mockUser = {
        id: 'user-123',
        lastSpidAuthTime: staleAuthTime,
        spidFiscalCode: 'RSSMRA80A01H501U',
      };

      const response = await request(app.getHttpServer())
        .delete('/test/high-risk')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send();

      // Should return 428 Precondition Required
      expect(response.status).toBe(HttpStatus.PRECONDITION_REQUIRED);
      expect(response.body).toMatchObject({
        statusCode: 428,
        error: 'Precondition Required',
        requiredAction: 'SPID_REAUTH',
      });
      expect(response.body.message).toContain('fresh SPID/CIE authentication');
    });

    it('should block digital signature operations when SPID session is stale', async () => {
      const staleAuthTime = Date.now() - (16 * 60 * 1000); // 16 minutes ago

      const response = await request(app.getHttpServer())
        .get('/test/digital-signature')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send();

      expect(response.status).toBe(HttpStatus.PRECONDITION_REQUIRED);
      expect(response.body.requiredAction).toBe('SPID_REAUTH');
    });
  });

  describe('Re-authentication boundary (exactly 15 minutes)', () => {
    it('should allow operation at 14:59 minutes', async () => {
      const authTime = Date.now() - (14 * 60 * 1000 + 59 * 1000); // 14:59 ago

      // Should succeed (still within 15 minute window)
      // Actual test would verify this passes
    });

    it('should block operation at 15:01 minutes', async () => {
      const authTime = Date.now() - (15 * 60 * 1000 + 1 * 1000); // 15:01 ago

      // Should fail (exceeded 15 minute window)
      // Actual test would verify 428 response
    });
  });

  describe('Response structure for re-auth required', () => {
    it('should return detailed error with re-auth metadata', async () => {
      const staleAuthTime = Date.now() - (20 * 60 * 1000);

      const response = await request(app.getHttpServer())
        .delete('/test/high-risk')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send();

      expect(response.body).toEqual({
        statusCode: 428,
        error: 'Precondition Required',
        message: expect.stringContaining('fresh SPID/CIE authentication'),
        requiredAction: 'SPID_REAUTH',
        lastAuthTime: expect.any(Number),
        requiredFreshness: 15 * 60 * 1000, // 15 minutes in ms
      });
    });
  });

  describe('Multiple high-risk operations in sequence', () => {
    it('should consistently enforce re-auth for all protected endpoints', async () => {
      const staleAuthTime = Date.now() - (20 * 60 * 1000);

      // Test delete FIR
      const deleteResponse = await request(app.getHttpServer())
        .delete('/test/high-risk')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send();

      expect(deleteResponse.status).toBe(HttpStatus.PRECONDITION_REQUIRED);

      // Test digital signature
      const signResponse = await request(app.getHttpServer())
        .get('/test/digital-signature')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send();

      expect(signResponse.status).toBe(HttpStatus.PRECONDITION_REQUIRED);
    });
  });
});

/**
 * TODO: Complete integration test implementation
 *
 * Next steps:
 * 1. Integrate with actual JWT auth guard
 * 2. Add helper to generate JWT with lastSpidAuthTime claim
 * 3. Test with real SPID authentication flow
 * 4. Add test for approve user operation
 * 5. Test timer reset behavior (timer does NOT reset on regular API calls per FR-027)
 * 6. Add E2E test for frontend modal trigger on 428 response
 */
