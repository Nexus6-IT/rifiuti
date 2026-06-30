import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import * as request from 'supertest'
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service'
import { AppModule } from '../../src/app.module'

/**
 * Task Assignment Integration Tests
 * T182: Integration test for task assignment per User Story 6
 *
 * Purpose: Verify optimal driver selection end-to-end
 *
 * Test Scenarios from spec.md:
 * - US6 Scenario 1: Hazardous waste assigned to driver with ADR certification
 * - US6 Scenario 2: Drivers see tasks sorted by proximity (GPS)
 * - US6 Scenario 3: Fleet manager reassigns task
 * - US6 Scenario 4: Load balancing - distribute evenly
 * - US6 Scenario 5: Capacity check - reject if over capacity
 *
 * Scoring Algorithm Validation:
 * score = (certifications * 40) + (availableCapacity * 30) + (workloadBalance * 30)
 */
describe('Task Assignment Integration Tests', () => {
  let app: INestApplication
  let prisma: PrismaService
  let authToken: string
  let tenantId: string
  let fleetManagerId: string

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()

    prisma = app.get<PrismaService>(PrismaService)

    // Create test tenant and user
    const tenant = await prisma.tenant.create({
      data: {
        partitaIva: '12345678901',
        ragioneSociale: 'Test Transport Company',
        address: 'Via Test 1',
        city: 'Rome',
        province: 'RM',
        postalCode: '00100',
      },
    })

    tenantId = tenant.id

    const user = await prisma.user.create({
      data: {
        tenantId,
        keycloakId: 'keycloak-fleet-manager-001',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@test.com',
        role: 'ADMIN',
      },
    })

    fleetManagerId = user.id

    // Generate JWT token (simplified for test)
    authToken = 'Bearer test-jwt-token'
  })

  afterAll(async () => {
    // Cleanup test data
    await prisma.resourceOwnership.deleteMany({
      where: { tenantId },
    })

    await prisma.user.deleteMany({
      where: { tenantId },
    })

    await prisma.tenant.delete({
      where: { id: tenantId },
    })

    await app.close()
  })

  describe('US6 Scenario 1: Hazardous Waste Assignment (ADR Certification)', () => {
    let driver1Id: string
    let driver2Id: string
    let vehicle1Id: string
    let vehicle2Id: string
    let firId: string

    beforeEach(async () => {
      // Create two drivers
      const driver1 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-with-adr',
          fiscalCode: 'DRVR01',
          firstName: 'Driver',
          lastName: 'WithADR',
          email: 'driver1@test.com',
          role: 'OPERATOR',
        },
      })
      driver1Id = driver1.id

      const driver2 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-without-adr',
          fiscalCode: 'DRVR02',
          firstName: 'Driver',
          lastName: 'NoADR',
          email: 'driver2@test.com',
          role: 'OPERATOR',
        },
      })
      driver2Id = driver2.id

      // Create vehicle assignments
      vehicle1Id = 'vehicle-adr-truck'
      vehicle2Id = 'vehicle-standard-truck'

      // Driver 1: Has ADR certification
      await prisma.resourceOwnership.create({
        data: {
          userId: driver1Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: vehicle1Id,
          assignedBy: fleetManagerId,
          metadata: {
            certifications: ['ADR', 'HACCP'],
            maxCapacity: 1000,
            currentLoad: 0,
            assignedTasks: 0,
            zoneIds: ['zone-north'],
          },
        },
      })

      // Driver 2: No ADR certification
      await prisma.resourceOwnership.create({
        data: {
          userId: driver2Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: vehicle2Id,
          assignedBy: fleetManagerId,
          metadata: {
            certifications: ['HACCP'],
            maxCapacity: 1000,
            currentLoad: 0,
            assignedTasks: 0,
            zoneIds: ['zone-north'],
          },
        },
      })

      // Create hazardous waste FIR
      const fir = await prisma.fIR.create({
        data: {
          tenantId,
          firNumber: 'FIR-HAZMAT-001',
          producerUserId: fleetManagerId,
          producerPartitaIva: '12345678901',
          producerName: 'Producer',
          producerAddress: 'Via Producer 1',
          carrierPartitaIva: '98765432109',
          carrierName: 'Carrier',
          carrierVehiclePlate: 'XX999XX',
          receiverPartitaIva: '11223344556',
          receiverName: 'Receiver',
          receiverAddress: 'Via Receiver 1',
          cerCode: '070103', // Hazardous waste code
          wasteDescription: 'Solventi organici alogenati',
          wasteCategory: 'Pericoloso',
          quantity: 500,
          transportDate: new Date(),
        },
      })
      firId = fir.id
    })

    afterEach(async () => {
      await prisma.fIR.deleteMany({
        where: { id: firId },
      })

      await prisma.resourceOwnership.deleteMany({
        where: { userId: { in: [driver1Id, driver2Id] } },
      })

      await prisma.user.deleteMany({
        where: { id: { in: [driver1Id, driver2Id] } },
      })
    })

    it('should automatically assign hazardous waste to driver with ADR certification', async () => {
      // Act: Automatic assignment
      const response = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${firId}/assign`)
        .set('Authorization', authToken)
        .send({})
        .expect(200)

      // Assert: Should assign to driver with ADR
      expect(response.body.success).toBe(true)
      expect(response.body.data.assignedDriverId).toBe(driver1Id)
      expect(response.body.data.assignmentMethod).toBe('automatic')
    })

    it('should warn if manually assigning hazardous waste to driver without ADR', async () => {
      // Act: Manual assignment to unqualified driver
      const response = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${firId}/assign`)
        .set('Authorization', authToken)
        .send({
          driverId: driver2Id, // Driver without ADR
          reason: 'Emergency override',
        })
        .expect(200)

      // Assert: Should complete with warnings
      expect(response.body.success).toBe(true)
      expect(response.body.data.assignedDriverId).toBe(driver2Id)
      expect(response.body.data.warnings).toBeDefined()
      expect(response.body.data.warnings.length).toBeGreaterThan(0)
      expect(response.body.data.warnings[0]).toContain('ADR')
    })
  })

  describe('US6 Scenario 4: Load Balancing', () => {
    let driver1Id: string
    let driver2Id: string
    let driver3Id: string
    let firId: string

    beforeEach(async () => {
      // Create three drivers with different workloads
      const driver1 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-heavy-load',
          fiscalCode: 'DRVR11',
          firstName: 'Heavy',
          lastName: 'Load',
          email: 'heavy@test.com',
          role: 'OPERATOR',
        },
      })
      driver1Id = driver1.id

      const driver2 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-light-load',
          fiscalCode: 'DRVR12',
          firstName: 'Light',
          lastName: 'Load',
          email: 'light@test.com',
          role: 'OPERATOR',
        },
      })
      driver2Id = driver2.id

      const driver3 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-medium-load',
          fiscalCode: 'DRVR13',
          firstName: 'Medium',
          lastName: 'Load',
          email: 'medium@test.com',
          role: 'OPERATOR',
        },
      })
      driver3Id = driver3.id

      // Assign vehicles with different workloads
      await prisma.resourceOwnership.create({
        data: {
          userId: driver1Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: 'vehicle-heavy',
          assignedBy: fleetManagerId,
          metadata: {
            certifications: [],
            maxCapacity: 1000,
            currentLoad: 800, // Heavy load
            assignedTasks: 8,
            zoneIds: ['zone-north'],
          },
        },
      })

      await prisma.resourceOwnership.create({
        data: {
          userId: driver2Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: 'vehicle-light',
          assignedBy: fleetManagerId,
          metadata: {
            certifications: [],
            maxCapacity: 1000,
            currentLoad: 100, // Light load - BEST CHOICE
            assignedTasks: 1,
            zoneIds: ['zone-north'],
          },
        },
      })

      await prisma.resourceOwnership.create({
        data: {
          userId: driver3Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: 'vehicle-medium',
          assignedBy: fleetManagerId,
          metadata: {
            certifications: [],
            maxCapacity: 1000,
            currentLoad: 500, // Medium load
            assignedTasks: 5,
            zoneIds: ['zone-north'],
          },
        },
      })

      // Create non-hazardous FIR
      const fir = await prisma.fIR.create({
        data: {
          tenantId,
          firNumber: 'FIR-BALANCE-001',
          producerUserId: fleetManagerId,
          producerPartitaIva: '12345678901',
          producerName: 'Producer',
          producerAddress: 'Via Producer 1',
          carrierPartitaIva: '98765432109',
          carrierName: 'Carrier',
          carrierVehiclePlate: 'XX999XX',
          receiverPartitaIva: '11223344556',
          receiverName: 'Receiver',
          receiverAddress: 'Via Receiver 1',
          cerCode: '150101', // Non-hazardous
          wasteDescription: 'Imballaggi in carta',
          wasteCategory: 'Non pericoloso',
          quantity: 100,
          transportDate: new Date(),
        },
      })
      firId = fir.id
    })

    afterEach(async () => {
      await prisma.fIR.deleteMany({
        where: { id: firId },
      })

      await prisma.resourceOwnership.deleteMany({
        where: { userId: { in: [driver1Id, driver2Id, driver3Id] } },
      })

      await prisma.user.deleteMany({
        where: { id: { in: [driver1Id, driver2Id, driver3Id] } },
      })
    })

    it('should assign to driver with lightest load (load balancing)', async () => {
      // Act: Automatic assignment
      const response = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${firId}/assign`)
        .set('Authorization', authToken)
        .send({})
        .expect(200)

      // Assert: Should assign to driver with lightest load
      expect(response.body.success).toBe(true)
      expect(response.body.data.assignedDriverId).toBe(driver2Id) // Light load driver
    })

    it('should list qualified drivers sorted by score', async () => {
      // Act: Get qualified drivers
      const response = await request(app.getHttpServer())
        .get(`/api/v1/tasks/${firId}/qualified-drivers`)
        .set('Authorization', authToken)
        .expect(200)

      // Assert: All three drivers qualified, sorted by score
      expect(response.body.success).toBe(true)
      expect(response.body.data.qualifiedDrivers).toHaveLength(3)
      expect(response.body.data.qualifiedDrivers[0].userId).toBe(driver2Id) // Best score
      expect(response.body.data.qualifiedDrivers[0].score).toBeGreaterThan(
        response.body.data.qualifiedDrivers[1].score
      )
    })
  })

  describe('US6 Scenario 5: Capacity Check', () => {
    let driverId: string
    let firId: string

    beforeEach(async () => {
      const driver = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-full-capacity',
          fiscalCode: 'DRVR21',
          firstName: 'Full',
          lastName: 'Capacity',
          email: 'full@test.com',
          role: 'OPERATOR',
        },
      })
      driverId = driver.id

      // Driver with almost full vehicle
      await prisma.resourceOwnership.create({
        data: {
          userId: driverId,
          tenantId,
          resourceType: 'vehicle',
          resourceId: 'vehicle-almost-full',
          assignedBy: fleetManagerId,
          metadata: {
            certifications: [],
            maxCapacity: 1000,
            currentLoad: 950, // Almost full
            assignedTasks: 5,
            zoneIds: ['zone-north'],
          },
        },
      })

      // Create heavy FIR (exceeds available capacity)
      const fir = await prisma.fIR.create({
        data: {
          tenantId,
          firNumber: 'FIR-HEAVY-001',
          producerUserId: fleetManagerId,
          producerPartitaIva: '12345678901',
          producerName: 'Producer',
          producerAddress: 'Via Producer 1',
          carrierPartitaIva: '98765432109',
          carrierName: 'Carrier',
          carrierVehiclePlate: 'XX999XX',
          receiverPartitaIva: '11223344556',
          receiverName: 'Receiver',
          receiverAddress: 'Via Receiver 1',
          cerCode: '150101',
          wasteDescription: 'Heavy waste',
          wasteCategory: 'Non pericoloso',
          quantity: 100, // Exceeds available capacity (950 + 100 > 1000)
          transportDate: new Date(),
        },
      })
      firId = fir.id
    })

    afterEach(async () => {
      await prisma.fIR.deleteMany({
        where: { id: firId },
      })

      await prisma.resourceOwnership.deleteMany({
        where: { userId: driverId },
      })

      await prisma.user.deleteMany({
        where: { id: driverId },
      })
    })

    it('should reject automatic assignment if no driver has sufficient capacity', async () => {
      // Act & Assert
      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${firId}/assign`)
        .set('Authorization', authToken)
        .send({})
        .expect(400) // Bad Request - No qualified drivers
    })

    it('should reject manual assignment if driver exceeds capacity', async () => {
      // Act & Assert
      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${firId}/assign`)
        .set('Authorization', authToken)
        .send({
          driverId,
          reason: 'Try to force assignment',
        })
        .expect(400) // Bad Request - Capacity exceeded
    })
  })

  describe('US6 Scenario 3: Manual Reassignment', () => {
    let driver1Id: string
    let driver2Id: string
    let firId: string

    beforeEach(async () => {
      const driver1 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-original',
          fiscalCode: 'DRVR31',
          firstName: 'Original',
          lastName: 'Driver',
          email: 'original@test.com',
          role: 'OPERATOR',
        },
      })
      driver1Id = driver1.id

      const driver2 = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: 'driver-replacement',
          fiscalCode: 'DRVR32',
          firstName: 'Replacement',
          lastName: 'Driver',
          email: 'replacement@test.com',
          role: 'OPERATOR',
        },
      })
      driver2Id = driver2.id

      // Assign vehicles
      await prisma.resourceOwnership.create({
        data: {
          userId: driver1Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: 'vehicle-1',
          assignedBy: fleetManagerId,
          metadata: {
            certifications: [],
            maxCapacity: 1000,
            currentLoad: 200,
            assignedTasks: 2,
            zoneIds: ['zone-north'],
          },
        },
      })

      await prisma.resourceOwnership.create({
        data: {
          userId: driver2Id,
          tenantId,
          resourceType: 'vehicle',
          resourceId: 'vehicle-2',
          assignedBy: fleetManagerId,
          metadata: {
            certifications: [],
            maxCapacity: 1000,
            currentLoad: 100,
            assignedTasks: 1,
            zoneIds: ['zone-north'],
          },
        },
      })

      // Create FIR assigned to driver1
      const fir = await prisma.fIR.create({
        data: {
          tenantId,
          firNumber: 'FIR-REASSIGN-001',
          producerUserId: fleetManagerId,
          producerPartitaIva: '12345678901',
          producerName: 'Producer',
          producerAddress: 'Via Producer 1',
          carrierUserId: driver1Id, // Initially assigned to driver1
          carrierPartitaIva: '98765432109',
          carrierName: 'Carrier',
          carrierVehiclePlate: 'XX999XX',
          receiverPartitaIva: '11223344556',
          receiverName: 'Receiver',
          receiverAddress: 'Via Receiver 1',
          cerCode: '150101',
          wasteDescription: 'Waste',
          wasteCategory: 'Non pericoloso',
          quantity: 150,
          transportDate: new Date(),
        },
      })
      firId = fir.id
    })

    afterEach(async () => {
      await prisma.fIR.deleteMany({
        where: { id: firId },
      })

      await prisma.resourceOwnership.deleteMany({
        where: { userId: { in: [driver1Id, driver2Id] } },
      })

      await prisma.user.deleteMany({
        where: { id: { in: [driver1Id, driver2Id] } },
      })
    })

    it('should successfully reassign task to different driver', async () => {
      // Act: Reassign from driver1 to driver2
      const response = await request(app.getHttpServer())
        .put(`/api/v1/tasks/${firId}/reassign`)
        .set('Authorization', authToken)
        .send({
          newDriverId: driver2Id,
          reason: 'Driver 1 vehicle breakdown',
        })
        .expect(200)

      // Assert
      expect(response.body.success).toBe(true)
      expect(response.body.data.previousDriverId).toBe(driver1Id)
      expect(response.body.data.newDriverId).toBe(driver2Id)
      expect(response.body.data.reason).toBe('Driver 1 vehicle breakdown')
    })

    it('should require reason for reassignment', async () => {
      // Act & Assert: Reassign without reason
      await request(app.getHttpServer())
        .put(`/api/v1/tasks/${firId}/reassign`)
        .set('Authorization', authToken)
        .send({
          newDriverId: driver2Id,
          reason: '', // Empty reason
        })
        .expect(400) // Bad Request
    })
  })
})
