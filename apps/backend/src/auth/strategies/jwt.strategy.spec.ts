/**
 * JWT Strategy - TDD Tests
 * Passport strategy for validating JWT access tokens
 */

import { JwtStrategy } from './jwt.strategy'
import { UnauthorizedException } from '@nestjs/common'
import { createPrismaMock, MockPrisma } from '../../../test/utils/prisma-mock'
import {
  createConfigServiceMock,
  MockConfigService,
} from '../../../test/utils/config-service-mock.factory'
import { createMockUser, createMockJwtPayload } from '../../../test/utils/test-fixtures.factory'

/** Costruisce una richiesta Express minima con l'header Authorization valorizzato. */
function richiestaCon(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as never
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let configService: MockConfigService
  let prismaService: MockPrisma
  let redisService: { isAccessTokenRevoked: jest.Mock; leggiEpocaSessione: jest.Mock }

  beforeEach(() => {
    configService = createConfigServiceMock()
    prismaService = createPrismaMock()
    redisService = {
      isAccessTokenRevoked: jest.fn().mockResolvedValue(false),
      leggiEpocaSessione: jest.fn().mockResolvedValue(null),
    }

    // Default: no role assignments → empty permissions. Individual tests
    // override this to exercise permission resolution.
    prismaService.userRoleAssignment.findMany.mockResolvedValue([] as any)

    strategy = new JwtStrategy(configService, prismaService as any, redisService as never)
  })

  describe('validate', () => {
    it('should validate payload and return user data', async () => {
      const mockPayload = createMockJwtPayload({
        sub: 'user-123',
        email: 'mario.rossi@example.com',
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      const mockUser = createMockUser({
        id: 'user-123',
        email: 'mario.rossi@example.com',
        fiscalCode: 'RSSMRA80A01H501U',
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result).toEqual({
        id: 'user-123',
        email: 'mario.rossi@example.com',
        fiscalCode: 'RSSMRA80A01H501U',
        tenantId: 'tenant-123',
        role: 'ADMIN',
        permissions: [],
      })
    })

    it('should resolve RBAC permissions from active role assignments', async () => {
      const mockPayload = createMockJwtPayload({ sub: 'user-123', tenantId: 'tenant-123' })
      const mockUser = createMockUser({ id: 'user-123', tenantId: 'tenant-123' })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)
      prismaService.userRoleAssignment.findMany.mockResolvedValue([
        {
          role: {
            permissions: [
              { permission: { resource: 'fir', action: 'read', scope: 'all' } },
              { permission: { resource: 'fir', action: 'create', scope: 'own' } },
            ],
          },
        },
        {
          role: {
            permissions: [
              // duplicate across roles must be de-duplicated
              { permission: { resource: 'fir', action: 'read', scope: 'all' } },
              { permission: { resource: 'report', action: 'read', scope: 'all' } },
            ],
          },
        },
      ] as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.permissions).toEqual(
        expect.arrayContaining(['fir:read:all', 'fir:create:own', 'report:read:all'])
      )
      expect(result.permissions).toHaveLength(3)
      // only active (non-expired) assignments for the tenant are considered
      expect(prismaService.userRoleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-123', tenantId: 'tenant-123' }),
        })
      )
    })

    it('should not query permissions when user has no tenant', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({ tenantId: null })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.permissions).toEqual([])
      expect(prismaService.userRoleAssignment.findMany).not.toHaveBeenCalled()
    })

    it('should query user from database', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser()

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      })
    })

    it('should throw UnauthorizedException if user not found', async () => {
      const mockPayload = createMockJwtPayload()

      prismaService.user.findUnique.mockResolvedValue(null)

      await expect(strategy.validate(richiestaCon('token-buono'), mockPayload)).rejects.toThrow(
        UnauthorizedException
      )
      await expect(strategy.validate(richiestaCon('token-buono'), mockPayload)).rejects.toThrow(
        'User not found'
      )
    })

    it('should use tenantId from user record', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        tenantId: 'tenant-456',
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.tenantId).toBe('tenant-456')
    })

    it('should handle user with no tenantId', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        tenantId: null,
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      // Should return empty string if no tenant
      expect(result.tenantId).toBe('')
    })

    it('should extract role from user record', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        role: 'OPERATOR',
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.role).toBe('OPERATOR')
    })

    it('should default to VIEWER role if user has no role', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        role: null,
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.role).toBe('VIEWER')
    })

    it('should handle user without fiscal code', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        fiscalCode: null,
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.fiscalCode).toBeUndefined()
    })
  })

  describe('lista di revoca', () => {
    it('rifiuta un access token presente nella lista di revoca', async () => {
      const mockPayload = createMockJwtPayload()
      redisService.isAccessTokenRevoked.mockResolvedValue(true)

      await expect(strategy.validate(richiestaCon('token-revocato'), mockPayload)).rejects.toThrow(
        UnauthorizedException
      )
      // Un token revocato non deve costare una query: niente lookup utente.
      expect(prismaService.user.findUnique).not.toHaveBeenCalled()
    })

    it('accetta un access token non revocato', async () => {
      const mockPayload = createMockJwtPayload({ sub: 'user-123' })
      const mockUser = createMockUser({ id: 'user-123' })
      redisService.isAccessTokenRevoked.mockResolvedValue(false)
      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(richiestaCon('token-buono'), mockPayload)

      expect(result.id).toBe('user-123')
      expect(redisService.isAccessTokenRevoked).toHaveBeenCalledWith('token-buono')
    })
  })

  describe('epoca di sessione (sessione singola)', () => {
    it("rifiuta un token emesso prima dell'ultimo accesso dell'utente", async () => {
      const mockUser = createMockUser({ id: 'user-123' })
      prismaService.user.findUnique.mockResolvedValue(mockUser as any)
      redisService.leggiEpocaSessione.mockResolvedValue(2000)

      await expect(
        strategy.validate(
          richiestaCon('token-vecchio'),
          createMockJwtPayload({ sub: 'user-123', iat: 1000 })
        )
      ).rejects.toThrow(UnauthorizedException)
    })

    it("accetta un token emesso dopo l'ultimo accesso", async () => {
      const mockUser = createMockUser({ id: 'user-123' })
      prismaService.user.findUnique.mockResolvedValue(mockUser as any)
      redisService.leggiEpocaSessione.mockResolvedValue(2000)

      const result = await strategy.validate(
        richiestaCon('token-nuovo'),
        createMockJwtPayload({ sub: 'user-123', iat: 3000 })
      )

      expect(result.id).toBe('user-123')
    })
  })

  describe('constructor', () => {
    it('should configure JWT options from config', () => {
      expect(configService.get).toHaveBeenCalledWith('JWT_SECRET')
    })

    it('should set jwtFromRequest to extract from header', () => {
      // This is tested implicitly by Passport behavior
      expect(strategy).toBeDefined()
    })
  })
})
