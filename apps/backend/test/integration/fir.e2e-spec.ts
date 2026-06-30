import { HttpStatus } from '@nestjs/common'
import { IntegrationTestSetup, TestUtilities } from './setup'
import { AppModule } from '../../src/app.module'

/**
 * FIR API Integration Tests
 * T237: End-to-end tests for FIR endpoints
 *
 * Tests:
 * - Create FIR
 * - List FIRs with pagination
 * - Get FIR by ID
 * - Update FIR
 * - Permission-based access control
 * - Multi-tenant isolation
 */
describe('FIR API (e2e)', () => {
  let testSetup: IntegrationTestSetup
  let testData: any

  beforeAll(async () => {
    testSetup = new IntegrationTestSetup()
    await testSetup.setup({ imports: [AppModule] })
  })

  afterAll(async () => {
    await testSetup.teardown()
  })

  beforeEach(async () => {
    await testSetup.cleanDatabase()
    testData = await testSetup.seedDatabase()
  })

  describe('POST /api/v1/fir', () => {
    it('should create FIR with valid data', async () => {
      const firData = {
        cerCode: '170904',
        quantity: 5000,
        unit: 'kg',
        wasteDescription: 'Plastica mista da imballaggio',
        producerFacilityId: testData.facilities.producer.id,
        destinationFacilityId: testData.facilities.transporter.id,
        transportDate: '2025-11-01T08:00:00Z',
      }

      const response = await testSetup
        .authenticatedRequest(
          'post',
          '/api/v1/fir',
          testData.users.operator.id,
          testData.tenant.id,
          ['fir:create:facility']
        )
        .send(firData)

      expect(response.status).toBe(HttpStatus.CREATED)
      TestUtilities.expectSuccessResponse(response)
      expect(response.body.data).toHaveProperty('id')
      expect(response.body.data).toHaveProperty('numeroProgressivo')
      expect(response.body.data.cerCode).toBe(firData.cerCode)
      expect(response.body.data.quantity).toBe(firData.quantity)
    })

    it('should reject FIR creation without permission', async () => {
      const firData = {
        cerCode: '170904',
        quantity: 5000,
        unit: 'kg',
        wasteDescription: 'Plastica mista',
        producerFacilityId: testData.facilities.producer.id,
        destinationFacilityId: testData.facilities.transporter.id,
      }

      const response = await testSetup
        .authenticatedRequest(
          'post',
          '/api/v1/fir',
          testData.users.driver.id,
          testData.tenant.id,
          ['fir:read:own'] // No create permission
        )
        .send(firData)

      TestUtilities.expectErrorResponse(response, HttpStatus.FORBIDDEN)
    })

    it('should validate CER code format', async () => {
      const firData = {
        cerCode: 'INVALID',
        quantity: 5000,
        unit: 'kg',
        wasteDescription: 'Test',
        producerFacilityId: testData.facilities.producer.id,
        destinationFacilityId: testData.facilities.transporter.id,
      }

      const response = await testSetup
        .authenticatedRequest(
          'post',
          '/api/v1/fir',
          testData.users.operator.id,
          testData.tenant.id,
          ['fir:create:facility']
        )
        .send(firData)

      TestUtilities.expectErrorResponse(response, HttpStatus.BAD_REQUEST)
    })
  })

  describe('GET /api/v1/fir', () => {
    beforeEach(async () => {
      // Create test FIRs
      for (let i = 0; i < 25; i++) {
        await testSetup
          .getApp()
          .get('PrismaService')
          .fIR.create({
            data: {
              id: `test-fir-${i}`,
              tenantId: testData.tenant.id,
              numeroProgressivo: `2025-${String(i).padStart(5, '0')}`,
              cerCode: '170904',
              quantity: 1000 + i * 100,
              unit: 'kg',
              wasteDescription: `Test waste ${i}`,
              producerFacilityId: testData.facilities.producer.id,
              destinationFacilityId: testData.facilities.transporter.id,
              status: i % 2 === 0 ? 'pending' : 'completed',
              createdBy: testData.users.operator.id,
            },
          })
      }
    })

    it('should list FIRs with pagination', async () => {
      const response = await testSetup
        .authenticatedRequest(
          'get',
          '/api/v1/fir?limit=10',
          testData.users.admin.id,
          testData.tenant.id,
          ['fir:read:all']
        )
        .send()

      expect(response.status).toBe(HttpStatus.OK)
      TestUtilities.expectPaginatedResponse(response)
      expect(response.body.data.length).toBe(10)
      expect(response.body.pagination.hasMore).toBe(true)
    })

    it('should filter FIRs by status', async () => {
      const response = await testSetup
        .authenticatedRequest(
          'get',
          '/api/v1/fir?status=pending',
          testData.users.admin.id,
          testData.tenant.id,
          ['fir:read:all']
        )
        .send()

      expect(response.status).toBe(HttpStatus.OK)
      response.body.data.forEach((fir: any) => {
        expect(fir.status).toBe('pending')
      })
    })

    it('should enforce tenant isolation', async () => {
      // Create FIR for different tenant
      await testSetup
        .getApp()
        .get('PrismaService')
        .fIR.create({
          data: {
            id: 'other-tenant-fir',
            tenantId: 'other-tenant',
            numeroProgressivo: '2025-99999',
            cerCode: '170904',
            quantity: 1000,
            unit: 'kg',
            wasteDescription: 'Other tenant waste',
            producerFacilityId: testData.facilities.producer.id,
            destinationFacilityId: testData.facilities.transporter.id,
            status: 'pending',
            createdBy: 'other-user',
          },
        })

      const response = await testSetup
        .authenticatedRequest('get', '/api/v1/fir', testData.users.admin.id, testData.tenant.id, [
          'fir:read:all',
        ])
        .send()

      expect(response.status).toBe(HttpStatus.OK)
      // Should not include FIR from other tenant
      const otherTenantFir = response.body.data.find((fir: any) => fir.id === 'other-tenant-fir')
      expect(otherTenantFir).toBeUndefined()
    })
  })

  describe('GET /api/v1/fir/:id', () => {
    let testFir: any

    beforeEach(async () => {
      testFir = await testSetup
        .getApp()
        .get('PrismaService')
        .fIR.create({
          data: {
            id: 'test-fir-detail',
            tenantId: testData.tenant.id,
            numeroProgressivo: '2025-00001',
            cerCode: '170904',
            quantity: 5000,
            unit: 'kg',
            wasteDescription: 'Test waste detail',
            producerFacilityId: testData.facilities.producer.id,
            destinationFacilityId: testData.facilities.transporter.id,
            status: 'pending',
            createdBy: testData.users.operator.id,
          },
        })
    })

    it('should get FIR by ID', async () => {
      const response = await testSetup
        .authenticatedRequest(
          'get',
          `/api/v1/fir/${testFir.id}`,
          testData.users.admin.id,
          testData.tenant.id,
          ['fir:read:all']
        )
        .send()

      expect(response.status).toBe(HttpStatus.OK)
      TestUtilities.expectSuccessResponse(response)
      expect(response.body.data.id).toBe(testFir.id)
      expect(response.body.data.numeroProgressivo).toBe(testFir.numeroProgressivo)
    })

    it('should return 404 for non-existent FIR', async () => {
      const response = await testSetup
        .authenticatedRequest(
          'get',
          '/api/v1/fir/non-existent-id',
          testData.users.admin.id,
          testData.tenant.id,
          ['fir:read:all']
        )
        .send()

      TestUtilities.expectErrorResponse(response, HttpStatus.NOT_FOUND)
    })
  })

  describe('PUT /api/v1/fir/:id', () => {
    let testFir: any

    beforeEach(async () => {
      testFir = await testSetup
        .getApp()
        .get('PrismaService')
        .fIR.create({
          data: {
            id: 'test-fir-update',
            tenantId: testData.tenant.id,
            numeroProgressivo: '2025-00002',
            cerCode: '170904',
            quantity: 5000,
            unit: 'kg',
            wasteDescription: 'Original description',
            producerFacilityId: testData.facilities.producer.id,
            destinationFacilityId: testData.facilities.transporter.id,
            status: 'pending',
            createdBy: testData.users.operator.id,
          },
        })
    })

    it('should update FIR with valid data', async () => {
      const updateData = {
        wasteDescription: 'Updated description',
        quantity: 6000,
      }

      const response = await testSetup
        .authenticatedRequest(
          'put',
          `/api/v1/fir/${testFir.id}`,
          testData.users.operator.id,
          testData.tenant.id,
          ['fir:update:facility']
        )
        .send(updateData)

      expect(response.status).toBe(HttpStatus.OK)
      TestUtilities.expectSuccessResponse(response)
      expect(response.body.data.wasteDescription).toBe(updateData.wasteDescription)
      expect(response.body.data.quantity).toBe(updateData.quantity)
    })

    it('should reject update without permission', async () => {
      const updateData = {
        wasteDescription: 'Unauthorized update',
      }

      const response = await testSetup
        .authenticatedRequest(
          'put',
          `/api/v1/fir/${testFir.id}`,
          testData.users.driver.id,
          testData.tenant.id,
          ['fir:read:own']
        )
        .send(updateData)

      TestUtilities.expectErrorResponse(response, HttpStatus.FORBIDDEN)
    })
  })
})
