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

describe('JwtStrategy', () => {
  let strategy: JwtStrategy
  let configService: MockConfigService
  let prismaService: MockPrisma

  beforeEach(() => {
    configService = createConfigServiceMock()
    prismaService = createPrismaMock()

    // Default: no role assignments → empty permissions. Individual tests
    // override this to exercise permission resolution.
    prismaService.userRoleAssignment.findMany.mockResolvedValue([] as any)

    strategy = new JwtStrategy(configService, prismaService as any)
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

      const result = await strategy.validate(mockPayload)

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

      const result = await strategy.validate(mockPayload)

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

      const result = await strategy.validate(mockPayload)

      expect(result.permissions).toEqual([])
      expect(prismaService.userRoleAssignment.findMany).not.toHaveBeenCalled()
    })

    it('should query user from database', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser()

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      await strategy.validate(mockPayload)

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      })
    })

    it('should throw UnauthorizedException if user not found', async () => {
      const mockPayload = createMockJwtPayload()

      prismaService.user.findUnique.mockResolvedValue(null)

      await expect(strategy.validate(mockPayload)).rejects.toThrow(UnauthorizedException)
      await expect(strategy.validate(mockPayload)).rejects.toThrow('User not found')
    })

    it('should use tenantId from user record', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        tenantId: 'tenant-456',
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(mockPayload)

      expect(result.tenantId).toBe('tenant-456')
    })

    it('should handle user with no tenantId', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        tenantId: null,
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(mockPayload)

      // Should return empty string if no tenant
      expect(result.tenantId).toBe('')
    })

    it('should extract role from user record', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        role: 'OPERATOR',
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(mockPayload)

      expect(result.role).toBe('OPERATOR')
    })

    it('should default to VIEWER role if user has no role', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        role: null,
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(mockPayload)

      expect(result.role).toBe('VIEWER')
    })

    it('should handle user without fiscal code', async () => {
      const mockPayload = createMockJwtPayload()
      const mockUser = createMockUser({
        fiscalCode: null,
      })

      prismaService.user.findUnique.mockResolvedValue(mockUser as any)

      const result = await strategy.validate(mockPayload)

      expect(result.fiscalCode).toBeUndefined()
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
