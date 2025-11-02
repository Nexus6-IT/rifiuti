import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../../src/infrastructure/database/prisma.service';
import * as request from 'supertest';

/**
 * Integration Test Setup
 * T237: End-to-end API testing infrastructure
 *
 * Purpose: Test complete request/response flow with real database
 *
 * Features:
 * - Database seeding and cleanup
 * - JWT token generation for authenticated tests
 * - Common test utilities
 * - Mock external services (RENTRI, email, S3)
 */

export class IntegrationTestSetup {
  private app: INestApplication;
  private prisma: PrismaService;
  private moduleRef: TestingModule;

  /**
   * Initialize test application
   */
  async setup(moduleMetadata: any): Promise<void> {
    this.moduleRef = await Test.createTestingModule(moduleMetadata).compile();

    this.app = this.moduleRef.createNestApplication();

    // Apply same pipes as production
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await this.app.init();
    this.prisma = this.app.get(PrismaService);
  }

  /**
   * Clean up after tests
   */
  async teardown(): Promise<void> {
    await this.cleanDatabase();
    await this.app.close();
  }

  /**
   * Get app instance for supertest
   */
  getApp(): INestApplication {
    return this.app;
  }

  /**
   * Get HTTP server for supertest
   */
  getHttpServer(): any {
    return this.app.getHttpServer();
  }

  /**
   * Clean database between tests
   */
  async cleanDatabase(): Promise<void> {
    // Delete in order to respect foreign keys
    await this.prisma.auditLog.deleteMany();
    await this.prisma.temporaryPermissionGrant.deleteMany();
    await this.prisma.resourceOwnership.deleteMany();
    await this.prisma.fIR.deleteMany();
    await this.prisma.notification.deleteMany();
    await this.prisma.userPermission.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.role.deleteMany();
    await this.prisma.facility.deleteMany();
    await this.prisma.tenant.deleteMany();
  }

  /**
   * Seed database with test data
   */
  async seedDatabase(): Promise<TestData> {
    // Create tenant
    const tenant = await this.prisma.tenant.create({
      data: {
        id: 'test-tenant-1',
        name: 'Test Municipality',
        subdomain: 'test-municipality',
        isActive: true,
      },
    });

    // Create facilities
    const producerFacility = await this.prisma.facility.create({
      data: {
        id: 'test-facility-producer',
        tenantId: tenant.id,
        name: 'Test Producer Facility',
        type: 'PRODUCER',
        address: 'Via Test 1, Milano',
        isActive: true,
      },
    });

    const transporterFacility = await this.prisma.facility.create({
      data: {
        id: 'test-facility-transporter',
        tenantId: tenant.id,
        name: 'Test Transporter',
        type: 'TRANSPORTER',
        address: 'Via Test 2, Milano',
        isActive: true,
      },
    });

    // Create roles
    const adminRole = await this.prisma.role.create({
      data: {
        id: 'test-role-admin',
        tenantId: tenant.id,
        name: 'Admin',
        description: 'Administrator role',
        permissions: ['*:*:*'],
        isSystem: true,
      },
    });

    const operatorRole = await this.prisma.role.create({
      data: {
        id: 'test-role-operator',
        tenantId: tenant.id,
        name: 'Operator',
        description: 'Operator role',
        permissions: ['fir:read:facility', 'fir:create:facility'],
        isSystem: false,
      },
    });

    const driverRole = await this.prisma.role.create({
      data: {
        id: 'test-role-driver',
        tenantId: tenant.id,
        name: 'Driver',
        description: 'Driver role',
        permissions: ['fir:read:own', 'fir:update:own'],
        isSystem: false,
      },
    });

    // Create users
    const adminUser = await this.prisma.user.create({
      data: {
        id: 'test-user-admin',
        tenantId: tenant.id,
        email: 'admin@test.com',
        firstName: 'Admin',
        lastName: 'User',
        passwordHash: 'hashed_password',
        isActive: true,
        emailVerified: true,
      },
    });

    const operatorUser = await this.prisma.user.create({
      data: {
        id: 'test-user-operator',
        tenantId: tenant.id,
        email: 'operator@test.com',
        firstName: 'Operator',
        lastName: 'User',
        passwordHash: 'hashed_password',
        isActive: true,
        emailVerified: true,
      },
    });

    const driverUser = await this.prisma.user.create({
      data: {
        id: 'test-user-driver',
        tenantId: tenant.id,
        email: 'driver@test.com',
        firstName: 'Driver',
        lastName: 'User',
        passwordHash: 'hashed_password',
        isActive: true,
        emailVerified: true,
      },
    });

    // Assign roles
    await this.prisma.userPermission.create({
      data: {
        userId: adminUser.id,
        roleId: adminRole.id,
        tenantId: tenant.id,
        scope: 'all',
      },
    });

    await this.prisma.userPermission.create({
      data: {
        userId: operatorUser.id,
        roleId: operatorRole.id,
        tenantId: tenant.id,
        scope: 'facility',
        facilityId: producerFacility.id,
      },
    });

    await this.prisma.userPermission.create({
      data: {
        userId: driverUser.id,
        roleId: driverRole.id,
        tenantId: tenant.id,
        scope: 'own',
      },
    });

    return {
      tenant,
      facilities: {
        producer: producerFacility,
        transporter: transporterFacility,
      },
      roles: {
        admin: adminRole,
        operator: operatorRole,
        driver: driverRole,
      },
      users: {
        admin: adminUser,
        operator: operatorUser,
        driver: driverUser,
      },
    };
  }

  /**
   * Generate JWT token for authenticated requests
   */
  generateAuthToken(userId: string, tenantId: string, permissions: string[]): string {
    // In real implementation, use JwtService
    // For tests, create a simple token or mock the JwtService
    const payload = {
      sub: userId,
      tenantId,
      permissions,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };

    // Return mock token for testing
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Make authenticated request
   */
  authenticatedRequest(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    userId: string,
    tenantId: string,
    permissions: string[],
  ): request.Test {
    const token = this.generateAuthToken(userId, tenantId, permissions);
    const req = request(this.getHttpServer());

    return req[method](path)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json');
  }
}

/**
 * Common test utilities
 */
export class TestUtilities {
  /**
   * Wait for async operation
   */
  static async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate random test ID
   */
  static generateTestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Expect pagination response structure
   */
  static expectPaginatedResponse(response: any): void {
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('pagination');
    expect(response.body.pagination).toHaveProperty('hasMore');
    expect(Array.isArray(response.body.data)).toBe(true);
  }

  /**
   * Expect error response structure
   */
  static expectErrorResponse(
    response: any,
    statusCode: number,
    errorType?: string,
  ): void {
    expect(response.status).toBe(statusCode);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('statusCode', statusCode);
    expect(response.body.error).toHaveProperty('message');
    expect(response.body.error).toHaveProperty('timestamp');
    expect(response.body.error).toHaveProperty('correlationId');

    if (errorType) {
      expect(response.body.error).toHaveProperty('error', errorType);
    }
  }

  /**
   * Expect success response structure
   */
  static expectSuccessResponse(response: any): void {
    expect(response.status).toBeLessThan(300);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
  }
}

/**
 * Mock external services for testing
 */
export class MockExternalServices {
  /**
   * Mock RENTRI service
   */
  static mockRentri() {
    return {
      syncFir: jest.fn().mockResolvedValue({ success: true, rentriId: 'RENTRI-123' }),
      getFirStatus: jest.fn().mockResolvedValue({ status: 'accepted' }),
    };
  }

  /**
   * Mock email service
   */
  static mockEmailService() {
    return {
      sendEmail: jest.fn().mockResolvedValue({ messageId: 'email-123' }),
      sendNotification: jest.fn().mockResolvedValue({ messageId: 'email-124' }),
    };
  }

  /**
   * Mock S3 storage
   */
  static mockS3Storage() {
    return {
      uploadFile: jest.fn().mockResolvedValue({ url: 'https://s3.amazonaws.com/file-123' }),
      deleteFile: jest.fn().mockResolvedValue({ success: true }),
      getSignedUrl: jest.fn().mockReturnValue('https://s3.amazonaws.com/file-123?signed=true'),
    };
  }

  /**
   * Mock Redis cache
   */
  static mockRedisCache() {
    const cache = new Map();
    return {
      get: jest.fn((key: string) => Promise.resolve(cache.get(key))),
      set: jest.fn((key: string, value: any) => {
        cache.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        cache.delete(key);
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        cache.clear();
        return Promise.resolve();
      }),
    };
  }
}

// Test data types
interface TestData {
  tenant: any;
  facilities: {
    producer: any;
    transporter: any;
  };
  roles: {
    admin: any;
    operator: any;
    driver: any;
  };
  users: {
    admin: any;
    operator: any;
    driver: any;
  };
}
