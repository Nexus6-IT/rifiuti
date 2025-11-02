import { PrismaClient } from '@prisma/client';

/**
 * Test Data Seeder
 *
 * Provides helper functions to seed test database with realistic data.
 * Used in integration and E2E tests for consistent test scenarios.
 */
export class TestDataSeeder {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a test tenant with default values
   */
  async createTestTenant(data?: Partial<any>) {
    const timestamp = Date.now();
    return this.prisma.tenant.create({
      data: {
        partitaIva: data?.partitaIva || '12345678901',
        ragioneSociale: data?.ragioneSociale || 'Test Company SRL',
        pec: data?.pec || 'test@pec.it',
        address: data?.address || 'Via Test 123',
        city: data?.city || 'Milano',
        province: data?.province || 'MI',
        postalCode: data?.postalCode || '20100',
        country: data?.country || 'IT',
        subscriptionTier: data?.subscriptionTier || 'PROFESSIONAL',
        subscriptionStatus: data?.subscriptionStatus || 'ACTIVE',
        ...data,
      },
    });
  }

  /**
   * Create a test user with default values
   */
  async createTestUser(tenantId: string, data?: Partial<any>) {
    const timestamp = Date.now();
    return this.prisma.user.create({
      data: {
        tenantId,
        keycloakId: data?.keycloakId || `keycloak-${timestamp}`,
        fiscalCode: data?.fiscalCode || 'RSSMRA80A01H501U',
        firstName: data?.firstName || 'Mario',
        lastName: data?.lastName || 'Rossi',
        email: data?.email || `test${timestamp}@example.com`,
        role: data?.role || 'OPERATOR',
        ...data,
      },
    });
  }

  /**
   * Create a test FIR with default values
   */
  async createTestFIR(tenantId: string, producerUserId: string, data?: Partial<any>) {
    const timestamp = Date.now();
    return this.prisma.fIR.create({
      data: {
        tenantId,
        firNumber: data?.firNumber || `FIR-TEST-${timestamp}`,
        status: data?.status || 'DRAFT',
        producerUserId,
        producerPartitaIva: data?.producerPartitaIva || '12345678901',
        producerName: data?.producerName || 'Producer Company',
        producerAddress: data?.producerAddress || 'Via Producer 1',
        carrierPartitaIva: data?.carrierPartitaIva || '98765432109',
        carrierName: data?.carrierName || 'Carrier Company',
        carrierVehiclePlate: data?.carrierVehiclePlate || 'AB123CD',
        receiverPartitaIva: data?.receiverPartitaIva || '11223344556',
        receiverName: data?.receiverName || 'Receiver Company',
        receiverAddress: data?.receiverAddress || 'Via Receiver 1',
        cerCode: data?.cerCode || '150102',
        wasteDescription: data?.wasteDescription || 'Plastic waste',
        wasteCategory: data?.wasteCategory || 'NON PERICOLOSO',
        quantity: data?.quantity || 100,
        unit: data?.unit || 'KG',
        transportDate: data?.transportDate || new Date(),
        ...data,
      },
    });
  }

  /**
   * Clean up all test data
   */
  async cleanup() {
    await this.prisma.activityLog.deleteMany();
    await this.prisma.notification.deleteMany();
    await this.prisma.fIRSignature.deleteMany();
    await this.prisma.fIR.deleteMany();
    await this.prisma.mUDReport.deleteMany();
    await this.prisma.backupHistory.deleteMany();
    await this.prisma.backupSchedule.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.tenant.deleteMany();
  }
}

/**
 * Get test Prisma client with default test database
 */
export function getTestPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://wasteflow:wasteflow123@localhost:5432/wasteflow_test';
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}
