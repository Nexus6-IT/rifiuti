import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { PrismaService } from '../../src/infrastructure/database/prisma.service'
import request from 'supertest'
import { Produttore, Trasportatore, Tenant, User } from '@prisma/client'

/**
 * Integration Test Setup
 * T237: End-to-end API testing infrastructure
 *
 * Purpose: Test complete request/response flow with real database
 *
 * Features:
 * - Database seeding and cleanup
 * - JWT-like token generation for authenticated tests
 * - Common test utilities
 * - Mock external services (RENTRI, email, S3)
 *
 * Allineato allo schema Prisma corrente (2026-07-25): il modello di autorizzazione
 * di produzione è `User.role` (enum UserRole: SUPER_ADMIN/ADMIN/OPERATOR/VIEWER)
 * verificato da RolesGuard — NON esiste più un modello `Facility`/`UserPermission`
 * con permessi puntuali in stringa: l'anagrafica delle controparti FIR vive ora
 * su `Produttore`/`Trasportatore`/`Destinatario` (snapshot immutabile, vedi
 * data-model FIR) e i ruoli/permessi RBAC granulari passano da `Role` +
 * `UserRoleAssignment` (non popolati qui perché non servono a testare gli
 * endpoint FIR, che si autorizzano solo su `User.role`).
 */

export class IntegrationTestSetup {
  private app: INestApplication
  private prisma: PrismaService
  private moduleRef: TestingModule

  /**
   * Initialize test application
   */
  async setup(moduleMetadata: any): Promise<void> {
    this.moduleRef = await Test.createTestingModule(moduleMetadata).compile()

    this.app = this.moduleRef.createNestApplication()

    // Apply same pipes as production
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    )

    await this.app.init()
    this.prisma = this.app.get(PrismaService)
  }

  /**
   * Clean up after tests
   */
  async teardown(): Promise<void> {
    await this.cleanDatabase()
    await this.app.close()
  }

  /**
   * Get app instance for supertest
   */
  getApp(): INestApplication {
    return this.app
  }

  /**
   * Get HTTP server for supertest
   */
  getHttpServer(): any {
    return this.app.getHttpServer()
  }

  /**
   * Clean database between tests
   *
   * Ordine di cancellazione compatibile con i vincoli FK dello schema
   * attuale (Produttore/Trasportatore/Destinatario sostituiscono il vecchio
   * modello Facility; niente più AuditLog/UserPermission).
   */
  async cleanDatabase(): Promise<void> {
    await this.prisma.activityLog.deleteMany()
    await this.prisma.temporaryPermissionGrant.deleteMany()
    await this.prisma.resourceOwnership.deleteMany()
    await this.prisma.fIR.deleteMany()
    await this.prisma.notification.deleteMany()
    await this.prisma.userRoleAssignment.deleteMany()
    await this.prisma.role.deleteMany()
    await this.prisma.user.deleteMany()
    await this.prisma.produttore.deleteMany()
    await this.prisma.trasportatore.deleteMany()
    await this.prisma.destinatario.deleteMany()
    await this.prisma.sedeDitta.deleteMany()
    await this.prisma.ditta.deleteMany()
    await this.prisma.tenant.deleteMany()
  }

  /**
   * Ditta, sede principale e riga di ruolo (produttore o trasportatore) con l'id indicato
   * (F2-10: l'identita' fiscale e l'indirizzo stanno su ditte e sedi_ditte).
   */
  private async creaRuolo(
    tenantId: string,
    ragioneSociale: string,
    partitaIva: string,
    ruolo: { produttoreId: string } | { trasportatoreId: string }
  ) {
    const ditta = await this.prisma.ditta.create({ data: { tenantId, ragioneSociale, partitaIva } })
    const sede = await this.prisma.sedeDitta.create({
      data: {
        tenantId,
        dittaId: ditta.id,
        via: 'Via Test',
        civico: '1',
        cap: '20100',
        comune: 'Milano',
        provincia: 'MI',
        principale: true,
      },
    })
    const comuni = { tenantId, dittaId: ditta.id, sedeId: sede.id }
    if ('produttoreId' in ruolo) {
      return this.prisma.produttore.create({ data: { id: ruolo.produttoreId, ...comuni } })
    }
    return this.prisma.trasportatore.create({
      data: { id: ruolo.trasportatoreId, ...comuni, numeroIscrizione: 'ISC-TEST-001' },
    })
  }

  /**
   * Seed database with test data
   */
  async seedDatabase(): Promise<TestData> {
    // Create tenant
    const tenant = await this.prisma.tenant.create({
      data: {
        id: 'test-tenant-1',
        ragioneSociale: 'Test Municipality',
        partitaIva: '00000000001',
      },
    })

    // Anagrafiche controparti FIR (sostituiscono il vecchio modello Facility)
    const produttore = (await this.creaRuolo(tenant.id, 'Test Producer Facility', '00000000002', {
      produttoreId: 'test-produttore-1',
    })) as Produttore

    const trasportatore = (await this.creaRuolo(tenant.id, 'Test Transporter', '00000000003', {
      trasportatoreId: 'test-trasportatore-1',
    })) as Trasportatore

    // Utenti applicativi. L'autorizzazione RolesGuard/@Roles verifica
    // esclusivamente `User.role` (UserRole enum) — non il sistema
    // Role/UserRoleAssignment, quindi qui basta impostare il ruolo giusto.
    const adminUser = await this.prisma.user.create({
      data: {
        id: 'test-user-admin',
        tenantId: tenant.id,
        keycloakId: 'keycloak-test-admin',
        fiscalCode: 'ADMTST80A01H501U',
        email: 'admin@test.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
      },
    })

    const operatorUser = await this.prisma.user.create({
      data: {
        id: 'test-user-operator',
        tenantId: tenant.id,
        keycloakId: 'keycloak-test-operator',
        fiscalCode: 'OPRTST80A01H501U',
        email: 'operator@test.com',
        firstName: 'Operator',
        lastName: 'User',
        role: 'OPERATOR',
      },
    })

    const driverUser = await this.prisma.user.create({
      data: {
        id: 'test-user-driver',
        tenantId: tenant.id,
        keycloakId: 'keycloak-test-driver',
        fiscalCode: 'DRVTST80A01H501U',
        email: 'driver@test.com',
        firstName: 'Driver',
        lastName: 'User',
        role: 'VIEWER',
      },
    })

    return {
      tenant,
      // Alias mantenuto per compatibilità con gli spec esistenti (in origine
      // "facility" = sede Produttore/Trasportatore): backed ora da Produttore
      // e Trasportatore, non più da un modello Facility (rimosso dallo schema).
      facilities: {
        producer: produttore,
        transporter: trasportatore,
      },
      users: {
        admin: adminUser,
        operator: operatorUser,
        driver: driverUser,
      },
    }
  }

  /**
   * Generate a mock token for authenticated requests.
   *
   * NOTA: non è un JWT firmato — JwtAuthGuard/passport-jwt lo rifiuterà
   * a runtime (401) contro un'istanza reale della strategy JWT. Serve solo
   * a far compilare/eseguire l'infrastruttura di test quando non è
   * disponibile un database/ambiente completo per generare un token reale
   * tramite JwtTokensService. Se in futuro serve un e2e autenticato reale,
   * sostituire con `app.get(JwtTokensService).generateAccessToken(...)`.
   */
  generateAuthToken(userId: string, tenantId: string, role = 'OPERATOR'): string {
    const payload = {
      sub: userId,
      tenantId,
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64')
  }

  /**
   * Make authenticated request
   */
  authenticatedRequest(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    userId: string,
    tenantId: string,
    role = 'OPERATOR'
  ): request.Test {
    const token = this.generateAuthToken(userId, tenantId, role)
    const req = request(this.getHttpServer())

    return req[method](path)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
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
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Generate random test ID
   */
  static generateTestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`
  }

  /**
   * Expect pagination response structure
   */
  static expectPaginatedResponse(response: any): void {
    expect(response.body).toHaveProperty('success', true)
    expect(response.body).toHaveProperty('data')
    expect(response.body).toHaveProperty('pagination')
    expect(response.body.pagination).toHaveProperty('hasMore')
    expect(Array.isArray(response.body.data)).toBe(true)
  }

  /**
   * Expect error response structure
   */
  static expectErrorResponse(response: any, statusCode: number, errorType?: string): void {
    expect(response.status).toBe(statusCode)
    expect(response.body).toHaveProperty('success', false)
    expect(response.body).toHaveProperty('error')
    expect(response.body.error).toHaveProperty('statusCode', statusCode)
    expect(response.body.error).toHaveProperty('message')
    expect(response.body.error).toHaveProperty('timestamp')
    expect(response.body.error).toHaveProperty('correlationId')

    if (errorType) {
      expect(response.body.error).toHaveProperty('error', errorType)
    }
  }

  /**
   * Expect success response structure
   */
  static expectSuccessResponse(response: any): void {
    expect(response.status).toBeLessThan(300)
    expect(response.body).toHaveProperty('success', true)
    expect(response.body).toHaveProperty('data')
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
    }
  }

  /**
   * Mock email service
   */
  static mockEmailService() {
    return {
      sendEmail: jest.fn().mockResolvedValue({ messageId: 'email-123' }),
      sendNotification: jest.fn().mockResolvedValue({ messageId: 'email-124' }),
    }
  }

  /**
   * Mock S3 storage
   */
  static mockS3Storage() {
    return {
      uploadFile: jest.fn().mockResolvedValue({ url: 'https://s3.amazonaws.com/file-123' }),
      deleteFile: jest.fn().mockResolvedValue({ success: true }),
      getSignedUrl: jest.fn().mockReturnValue('https://s3.amazonaws.com/file-123?signed=true'),
    }
  }

  /**
   * Mock Redis cache
   */
  static mockRedisCache() {
    const cache = new Map()
    return {
      get: jest.fn((key: string) => Promise.resolve(cache.get(key))),
      set: jest.fn((key: string, value: any) => {
        cache.set(key, value)
        return Promise.resolve()
      }),
      del: jest.fn((key: string) => {
        cache.delete(key)
        return Promise.resolve()
      }),
      clear: jest.fn(() => {
        cache.clear()
        return Promise.resolve()
      }),
    }
  }
}

// Test data types
interface TestData {
  tenant: Tenant
  facilities: {
    producer: Produttore
    transporter: Trasportatore
  }
  users: {
    admin: User
    operator: User
    driver: User
  }
}
