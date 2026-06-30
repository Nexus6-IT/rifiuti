import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { AppModule } from '../src/app.module'

/**
 * FIR Digital Signatures E2E Tests
 *
 * End-to-end tests for complete three-stage signature workflow:
 * 1. Producer signs FIR at emission
 * 2. Carrier signs FIR at pickup
 * 3. Receiver signs FIR at delivery
 *
 * Tests verify:
 * - Signature order enforcement
 * - SPID level 2+ requirement
 * - Document immutability after completion
 * - Cryptographic signature verification
 */
describe('FIR Digital Signatures (E2E)', () => {
  let app: INestApplication
  let prisma: PrismaClient

  // Mock user tokens
  let producerToken: string
  let carrierToken: string
  let receiverToken: string

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

    await app.init()

    prisma = new PrismaClient()

    // Create test users and get tokens
    await setupTestUsers()
  })

  afterAll(async () => {
    await cleanupTestData()
    await prisma.$disconnect()
    await app.close()
  })

  describe('Three-Stage Signature Workflow', () => {
    let firId: string

    beforeEach(async () => {
      // Create a new FIR for each test
      const createResponse = await request(app.getHttpServer())
        .post('/fir')
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          firNumber: `FIR-E2E-${Date.now()}`,
          producerPartitaIva: '12345678901',
          producerName: 'Test Producer',
          carrierPartitaIva: '98765432109',
          carrierName: 'Test Carrier',
          receiverPartitaIva: '11122233344',
          receiverName: 'Test Receiver',
          cerCode: '150101',
          wasteDescription: 'Paper waste',
          quantity: 100,
          unit: 'KG',
        })
        .expect(201)

      firId = createResponse.body.id
    })

    it('should complete full signature workflow', async () => {
      // 1. Producer signs
      const producerSignResponse = await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(200)

      expect(producerSignResponse.body.success).toBe(true)
      expect(producerSignResponse.body.signature).toBeDefined()
      expect(producerSignResponse.body.signature.role).toBe('PRODUCER')

      // Verify FIR status updated
      let firResponse = await request(app.getHttpServer())
        .get(`/fir/${firId}`)
        .set('Authorization', `Bearer ${producerToken}`)
        .expect(200)

      expect(firResponse.body.status).toBe('SIGNED_BY_PRODUCER')
      expect(firResponse.body.signatures).toHaveLength(1)

      // 2. Carrier signs
      const carrierSignResponse = await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .send({
          role: 'CARRIER',
        })
        .expect(200)

      expect(carrierSignResponse.body.success).toBe(true)
      expect(carrierSignResponse.body.signature.role).toBe('CARRIER')

      firResponse = await request(app.getHttpServer())
        .get(`/fir/${firId}`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .expect(200)

      expect(firResponse.body.status).toBe('IN_TRANSIT')
      expect(firResponse.body.signatures).toHaveLength(2)

      // 3. Receiver signs
      const receiverSignResponse = await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({
          role: 'RECEIVER',
        })
        .expect(200)

      expect(receiverSignResponse.body.success).toBe(true)
      expect(receiverSignResponse.body.signature.role).toBe('RECEIVER')

      firResponse = await request(app.getHttpServer())
        .get(`/fir/${firId}`)
        .set('Authorization', `Bearer ${receiverToken}`)
        .expect(200)

      expect(firResponse.body.status).toBe('COMPLETED')
      expect(firResponse.body.signatures).toHaveLength(3)
      expect(firResponse.body.isImmutable).toBe(true)
    })

    it('should reject carrier signature before producer', async () => {
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .send({
          role: 'CARRIER',
        })
        .expect(400)
    })

    it('should reject receiver signature before carrier', async () => {
      // Producer signs first
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(200)

      // Try to sign as receiver (should fail)
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({
          role: 'RECEIVER',
        })
        .expect(400)
    })

    it('should reject duplicate signature from same role', async () => {
      // Producer signs once
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(200)

      // Try to sign again (should fail)
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(400)
    })

    it('should reject modification after FIR is completed', async () => {
      // Complete all signatures
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({ role: 'PRODUCER' })
        .expect(200)

      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .send({ role: 'CARRIER' })
        .expect(200)

      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({ role: 'RECEIVER' })
        .expect(200)

      // Try to modify FIR (should fail - immutable)
      await request(app.getHttpServer())
        .put(`/fir/${firId}`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          quantity: 200, // Try to change quantity
        })
        .expect(400)
    })
  })

  describe('Signature Verification', () => {
    let firId: string

    beforeEach(async () => {
      // Create and fully sign FIR
      const createResponse = await request(app.getHttpServer())
        .post('/fir')
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          firNumber: `FIR-VERIFY-${Date.now()}`,
          producerPartitaIva: '12345678901',
          producerName: 'Producer',
          carrierPartitaIva: '98765432109',
          carrierName: 'Carrier',
          receiverPartitaIva: '11122233344',
          receiverName: 'Receiver',
          cerCode: '150101',
          wasteDescription: 'Waste',
          quantity: 100,
          unit: 'KG',
        })

      firId = createResponse.body.id

      // Apply all signatures
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({ role: 'PRODUCER' })

      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${carrierToken}`)
        .send({ role: 'CARRIER' })

      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({ role: 'RECEIVER' })
    })

    it('should verify all signatures are valid', async () => {
      const response = await request(app.getHttpServer()).get(`/fir/${firId}/verify`).expect(200)

      expect(response.body.allValid).toBe(true)
      expect(response.body.signatures).toHaveLength(3)

      response.body.signatures.forEach((sig: any) => {
        expect(sig.isValid).toBe(true)
        expect(sig.signerFiscalCode).toBeDefined()
        expect(sig.role).toBeDefined()
        expect(sig.signedAt).toBeDefined()
      })
    })

    it('should provide signature verification details', async () => {
      const response = await request(app.getHttpServer()).get(`/fir/${firId}/verify`).expect(200)

      const producerSig = response.body.signatures.find((s: any) => s.role === 'PRODUCER')

      expect(producerSig).toBeDefined()
      expect(producerSig.signatureMethod).toBe('ECDSA-SHA256')
      expect(producerSig.certificateHash).toBeDefined()
      expect(producerSig.timestampToken).toBeDefined()
    })

    it('should be accessible without authentication (public verification)', async () => {
      // Verify without Bearer token
      const response = await request(app.getHttpServer()).get(`/fir/${firId}/verify`).expect(200)

      expect(response.body.allValid).toBe(true)
    })
  })

  describe('SPID Level 2+ Requirement', () => {
    it('should reject signature from user with SPID Level 1', async () => {
      // Create user with SPID Level 1
      const level1Token = await createUserWithSpidLevel(1)

      const createResponse = await request(app.getHttpServer())
        .post('/fir')
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          firNumber: `FIR-LEVEL1-${Date.now()}`,
          producerPartitaIva: '12345678901',
          cerCode: '150101',
          quantity: 100,
          unit: 'KG',
        })

      const firId = createResponse.body.id

      // Try to sign with Level 1 (should fail)
      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${level1Token}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(403) // Forbidden - insufficient SPID level
    })

    it('should accept signature from user with SPID Level 2', async () => {
      // producerToken already has Level 2
      const createResponse = await request(app.getHttpServer())
        .post('/fir')
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          firNumber: `FIR-LEVEL2-${Date.now()}`,
          producerPartitaIva: '12345678901',
          cerCode: '150101',
          quantity: 100,
          unit: 'KG',
        })

      const firId = createResponse.body.id

      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${producerToken}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(200)
    })

    it('should accept signature from user with SPID Level 3', async () => {
      const level3Token = await createUserWithSpidLevel(3)

      const createResponse = await request(app.getHttpServer())
        .post('/fir')
        .set('Authorization', `Bearer ${level3Token}`)
        .send({
          firNumber: `FIR-LEVEL3-${Date.now()}`,
          producerPartitaIva: '12345678901',
          cerCode: '150101',
          quantity: 100,
          unit: 'KG',
        })

      const firId = createResponse.body.id

      await request(app.getHttpServer())
        .post(`/fir/${firId}/sign`)
        .set('Authorization', `Bearer ${level3Token}`)
        .send({
          role: 'PRODUCER',
        })
        .expect(200)
    })
  })

  /**
   * Helper Functions
   */

  async function setupTestUsers(): Promise<void> {
    // Create test users with SPID Level 2
    producerToken = await createUserWithSpidLevel(2, 'PRODUCER_FC', 'Producer User')
    carrierToken = await createUserWithSpidLevel(2, 'CARRIER_FC', 'Carrier User')
    receiverToken = await createUserWithSpidLevel(2, 'RECEIVER_FC', 'Receiver User')
  }

  async function createUserWithSpidLevel(
    spidLevel: number,
    fiscalCode = `FC${Date.now()}`,
    name = 'Test User'
  ): Promise<string> {
    // Mock SPID authentication to create user
    const response = await request(app.getHttpServer())
      .post('/auth/callback')
      .send({
        SAMLResponse: Buffer.from(
          JSON.stringify({
            fiscalCode,
            firstName: name,
            lastName: 'Test',
            email: `${fiscalCode.toLowerCase()}@test.it`,
            spidLevel,
            issuer: 'https://identity.infocert.it',
          })
        ).toString('base64'),
      })

    return response.body.accessToken
  }

  async function cleanupTestData(): Promise<void> {
    await prisma.fIR.deleteMany({
      where: {
        firNumber: {
          contains: 'E2E',
        },
      },
    })

    await prisma.user.deleteMany({
      where: {
        fiscalCode: {
          contains: 'FC',
        },
      },
    })
  }
})
