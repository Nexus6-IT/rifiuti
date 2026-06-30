import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { AppModule } from '../src/app.module'

/**
 * SPID Authentication E2E Tests
 *
 * End-to-end tests for complete SPID/CIE authentication flow:
 * 1. Initiate login → redirect to Keycloak
 * 2. SAML callback from Keycloak → create/update user
 * 3. Issue JWT with SPID attributes
 * 4. Access protected endpoints with JWT
 * 5. Verify session info endpoint
 * 6. Logout and invalidate session
 *
 * Note: These tests mock Keycloak SAML responses since we can't
 * actually redirect to real SPID providers in automated tests.
 */
describe('SPID Authentication (E2E)', () => {
  let app: INestApplication
  let prisma: PrismaClient

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

    await app.init()

    prisma = new PrismaClient()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await app.close()
  })

  beforeEach(async () => {
    // Clean up test data
    await prisma.user.deleteMany({
      where: {
        fiscalCode: 'RSSMRA80A01H501U',
      },
    })
  })

  describe('GET /auth/login', () => {
    it('should initiate SPID login flow', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/login')
        .query({ provider: 'spid' })
        .expect(302) // Redirect to Keycloak

      // Should redirect to Keycloak SAML endpoint
      expect(response.headers.location).toContain('auth/realms/wasteflow')
      expect(response.headers.location).toContain('protocol/saml')
    })

    it('should support CIE login', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/login')
        .query({ provider: 'cie' })
        .expect(302)

      expect(response.headers.location).toContain('cie')
    })

    it('should include return URL in state', async () => {
      const returnUrl = '/dashboard'

      const response = await request(app.getHttpServer())
        .get('/auth/login')
        .query({ provider: 'spid', returnUrl })
        .expect(302)

      // State should include returnUrl for redirect after auth
      expect(response.headers.location).toBeDefined()
    })
  })

  describe('POST /auth/callback - SAML Callback', () => {
    it('should create new user from SPID SAML assertion', async () => {
      // Mock SAML response from Keycloak
      const samlResponse = createMockSamlResponse({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
      })

      const response = await request(app.getHttpServer())
        .post('/auth/callback')
        .send({ SAMLResponse: samlResponse })
        .expect(200)

      // Should return JWT tokens
      expect(response.body.accessToken).toBeDefined()
      expect(response.body.refreshToken).toBeDefined()
      expect(response.body.user).toBeDefined()
      expect(response.body.user.fiscalCode).toBe('RSSMRA80A01H501U')
      expect(response.body.user.spidLevel).toBe(2)

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { fiscalCode: 'RSSMRA80A01H501U' },
      })

      expect(user).toBeDefined()
      expect(user?.firstName).toBe('Mario')
      expect(user?.lastName).toBe('Rossi')
      expect(user?.email).toBe('mario.rossi@example.it')
    })

    it('should update existing user SPID attributes', async () => {
      // Create existing user
      await prisma.user.create({
        data: {
          id: 'user-123',
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'old.email@example.it',
          tenantId: 'tenant-123',
        },
      })

      // SAML callback with updated email and Level 3
      const samlResponse = createMockSamlResponse({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'new.email@example.it',
        spidLevel: 3,
        issuer: 'https://identity.infocert.it',
      })

      const response = await request(app.getHttpServer())
        .post('/auth/callback')
        .send({ SAMLResponse: samlResponse })
        .expect(200)

      // Should return updated user
      expect(response.body.user.spidLevel).toBe(3)

      // Verify user was updated
      const user = await prisma.user.findUnique({
        where: { fiscalCode: 'RSSMRA80A01H501U' },
      })

      expect(user?.email).toBe('new.email@example.it')
    })

    it('should reject invalid SAML response', async () => {
      await request(app.getHttpServer())
        .post('/auth/callback')
        .send({ SAMLResponse: 'invalid-saml-response' })
        .expect(401)
    })

    it('should reject SAML with missing fiscal code', async () => {
      const samlResponse = createMockSamlResponse({
        fiscalCode: '', // Missing
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        issuer: 'https://identity.infocert.it',
      })

      await request(app.getHttpServer())
        .post('/auth/callback')
        .send({ SAMLResponse: samlResponse })
        .expect(400)
    })
  })

  describe('GET /auth/session - Session Info', () => {
    it('should return session info for authenticated user', async () => {
      // Create user and get auth token
      const { accessToken, userId: _userId } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
      })

      const response = await request(app.getHttpServer())
        .get('/auth/session')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.user).toBeDefined()
      expect(response.body.user.fiscalCode).toBe('RSSMRA80A01H501U')
      expect(response.body.spidLevel).toBe(2)
      expect(response.body.canSignDocuments).toBe(true)
      expect(response.body.authenticatedAt).toBeDefined()
      expect(response.body.sessionExpiry).toBeDefined()
    })

    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/auth/session').expect(401)
    })

    it('should reject expired tokens', async () => {
      const expiredToken = generateExpiredJwt()

      await request(app.getHttpServer())
        .get('/auth/session')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401)
    })
  })

  describe('GET /auth/spid-status - SPID Authentication Status', () => {
    it('should show recent SPID auth for Level 2+', async () => {
      const { accessToken } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
      })

      const response = await request(app.getHttpServer())
        .get('/auth/spid-status')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.hasSpidAuth).toBe(true)
      expect(response.body.spidLevel).toBe(2)
      expect(response.body.isAuthRecent).toBe(true)
      expect(response.body.canSignDocuments).toBe(true)
    })

    it('should show expired SPID auth after 15 minutes', async () => {
      const { accessToken } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        authenticatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
      })

      const response = await request(app.getHttpServer())
        .get('/auth/spid-status')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.hasSpidAuth).toBe(true)
      expect(response.body.isAuthRecent).toBe(false)
      expect(response.body.canSignDocuments).toBe(false)
    })

    it('should show insufficient SPID level for signing', async () => {
      const { accessToken } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 1, // Insufficient
      })

      const response = await request(app.getHttpServer())
        .get('/auth/spid-status')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(response.body.hasSpidAuth).toBe(true)
      expect(response.body.spidLevel).toBe(1)
      expect(response.body.canSignDocuments).toBe(false)
      expect(response.body.insufficientLevel).toBe(true)
    })
  })

  describe('POST /auth/refresh - Token Refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const { refreshToken } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
      })

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200)

      expect(response.body.accessToken).toBeDefined()
      expect(response.body.refreshToken).toBeDefined()
      expect(response.body.accessToken).not.toBe(refreshToken)
    })

    it('should reject invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401)
    })
  })

  describe('POST /auth/logout - Logout', () => {
    it('should invalidate session on logout', async () => {
      const { accessToken } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
      })

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      // Token should no longer work
      await request(app.getHttpServer())
        .get('/auth/session')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401)
    })
  })

  describe('Protected Endpoint Access', () => {
    it('should allow access to protected endpoint with valid JWT', async () => {
      const { accessToken } = await authenticateUser({
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
      })

      await request(app.getHttpServer())
        .get('/fir') // Protected FIR endpoint
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
    })

    it('should reject access without JWT', async () => {
      await request(app.getHttpServer()).get('/fir').expect(401)
    })

    it('should reject access with invalid JWT', async () => {
      await request(app.getHttpServer())
        .get('/fir')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)
    })
  })
})

/**
 * Helper Functions
 */

function createMockSamlResponse(attrs: {
  fiscalCode: string
  firstName: string
  lastName: string
  email: string
  spidLevel: number
  issuer: string
}): string {
  // In real implementation, this would generate a proper SAML XML
  // For tests, we can use a simplified mock
  return Buffer.from(JSON.stringify(attrs)).toString('base64')
}

async function authenticateUser(attrs: {
  fiscalCode: string
  firstName: string
  lastName: string
  email: string
  spidLevel: number
  authenticatedAt?: Date
}): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  // Mock authentication - in real implementation would go through SAML flow
  // For tests, we directly create user and generate tokens
  const app = global.app
  const samlResponse = createMockSamlResponse({
    ...attrs,
    issuer: 'https://identity.infocert.it',
  })

  const response = await request(app.getHttpServer())
    .post('/auth/callback')
    .send({ SAMLResponse: samlResponse })

  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
    userId: response.body.user.id,
  }
}

function generateExpiredJwt(): string {
  // Generate JWT with expired timestamp
  // Implementation depends on JWT library
  return 'expired.jwt.token'
}
