/**
 * FIR Workflow E2E Test
 * Integration test per workflow completo FIR
 */

import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/infrastructure/persistence/prisma.service'

describe('FIR Workflow (E2E)', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()

    // Apply same pipes as in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    )

    await app.init()

    prisma = app.get<PrismaService>(PrismaService)
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await app.close()
  })

  beforeEach(async () => {
    // Clean database before each test
    if (process.env.NODE_ENV === 'test') {
      await prisma.cleanDatabase()
    }
  })

  describe('Complete FIR Lifecycle', () => {
    it('should create FIR → emit FIR → get FIR', async () => {
      // 1. Health check
      await request(app.getHttpServer()).get('/health').expect(200)

      // 2. Seed CER code (normally from seed script)
      await prisma.cERCode.create({
        data: {
          code: '13 02 05*',
          description: 'oli minerali per motori',
          isPericoloso: true,
          category: '13',
          subcategory: '13 02',
        },
      })

      // 3. Create FIR (BOZZA)
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/fir')
        .set('Authorization', 'Bearer mock-token') // TODO: real JWT
        .send({
          produttoreId: 'tenant-producer-123',
          rifiuto: {
            cerCode: '13 02 05*',
            quantita: 120,
            unitaMisura: 'kg',
            statoFisico: 'Liquido',
          },
          trasportatoreId: 'tenant-transporter-456',
          destinatarioId: 'tenant-destination-789',
        })
        .expect(201)

      const firId = createResponse.body.id
      expect(createResponse.body.stato).toBe('BOZZA')
      expect(createResponse.body.numeroProgressivo).toBeNull()

      // TODO: 4. Emit FIR (when EmettiFIR endpoint implemented)
      // const emitResponse = await request(app.getHttpServer())
      //   .post(`/api/v1/fir/${firId}/emetti`)
      //   .set('Authorization', 'Bearer mock-token')
      //   .send({
      //     firmaProduttore: {
      //       firmatario: 'Mario Rossi',
      //       certificato: 'cert-mock-123',
      //     },
      //   })
      //   .expect(200)
      //
      // expect(emitResponse.body.stato).toBe('EMESSO')
      // expect(emitResponse.body.numeroProgressivo).toBeDefined()

      // TODO: 5. Get FIR by ID (when GET endpoint implemented)
      // await request(app.getHttpServer())
      //   .get(`/api/v1/fir/${firId}`)
      //   .set('Authorization', 'Bearer mock-token')
      //   .expect(200)
      //   .expect(res => {
      //     expect(res.body.id).toBe(firId)
      //     expect(res.body.stato).toBe('EMESSO')
      //   })
    })
  })

  describe('CER Search API', () => {
    beforeEach(async () => {
      // Seed CER codes
      await prisma.cERCode.createMany({
        data: [
          {
            code: '13 02 05*',
            description: 'oli minerali per motori',
            isPericoloso: true,
            category: '13',
          },
          {
            code: '15 01 01',
            description: 'imballaggi in carta e cartone',
            isPericoloso: false,
            category: '15',
          },
        ],
      })
    })

    it('should search CER codes by keyword', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/cer/search?q=olio')
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveLength(1)
          expect(res.body[0].code).toBe('13 02 05*')
          expect(res.body[0].description).toContain('oli minerali')
        })
    })

    it('should filter by pericoloso', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/cer/search?q=imballaggi&pericoloso=false')
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveLength(1)
          expect(res.body[0].isPericoloso).toBe(false)
        })
    })

    it('should return empty array for no matches', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/cer/search?q=nonexistent')
        .expect(200)
        .expect(res => {
          expect(res.body).toHaveLength(0)
        })
    })
  })

  describe('Validation & Error Handling', () => {
    it('should return 400 for invalid CER code', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/fir')
        .set('Authorization', 'Bearer mock-token')
        .send({
          produttoreId: 'tenant-123',
          rifiuto: {
            cerCode: '99 99 99', // Non-existent CER
            quantita: 120,
          },
          trasportatoreId: 'tenant-456',
          destinatarioId: 'tenant-789',
        })
        .expect(400)
        .expect(res => {
          expect(res.body.message).toContain('CER code not found')
        })
    })

    it('should return 400 for negative quantity', async () => {
      await prisma.cERCode.create({
        data: {
          code: '15 01 01',
          description: 'test',
          isPericoloso: false,
          category: '15',
        },
      })

      await request(app.getHttpServer())
        .post('/api/v1/fir')
        .set('Authorization', 'Bearer mock-token')
        .send({
          produttoreId: 'tenant-123',
          rifiuto: {
            cerCode: '15 01 01',
            quantita: -100, // Invalid
          },
          trasportatoreId: 'tenant-456',
          destinatarioId: 'tenant-789',
        })
        .expect(400)
    })
  })
})
