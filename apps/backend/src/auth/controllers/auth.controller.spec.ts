/**
 * Auth Controller - TDD Tests
 * Controller for authentication endpoints (SPID login, token refresh, logout)
 */

import { Test, TestingModule } from '@nestjs/testing'
import { AuthController } from './auth.controller'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { ConfigService } from '@nestjs/config'
import { UnauthorizedException } from '@nestjs/common'
import { createPrismaMock, MockPrisma } from '../../../test/utils/prisma-mock'
import { createConfigServiceMock, MockConfigService } from '../../../test/utils/config-service-mock.factory'
import { createMockUser, createMockSpidUser, createMockTokens, VALID_FISCAL_CODES } from '../../../test/utils/test-fixtures.factory'

describe('AuthController', () => {
  let controller: AuthController
  let jwtTokensService: jest.Mocked<JwtTokensService>
  let redisService: jest.Mocked<RedisService>
  let prismaService: MockPrisma
  let configService: MockConfigService

  beforeEach(async () => {
    const mockJwtTokensService = {
      generateTokenPair: jest.fn(),
      generateAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
      extractTokenFromHeader: jest.fn(),
    }

    const mockRedisService = {
      storeRefreshToken: jest.fn(),
      isRefreshTokenValid: jest.fn(),
      revokeRefreshToken: jest.fn(),
      revokeAccessToken: jest.fn(),
    }

    prismaService = createPrismaMock()
    configService = createConfigServiceMock()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: JwtTokensService, useValue: mockJwtTokensService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    jwtTokensService = module.get(JwtTokensService)
    redisService = module.get(RedisService)
  })

  describe('spidLogin', () => {
    it('should initiate SPID login (handled by passport)', () => {
      // This endpoint is protected by AuthGuard('spid')
      // Passport will redirect to SPID IdP
      expect(controller.spidLogin).toBeDefined()
    })
  })

  describe('spidCallback', () => {
    it('should handle SPID callback and return tokens', async () => {
      const mockSpidUser = createMockSpidUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        firstName: 'Mario',
        lastName: 'Rossi',
        isNewUser: false,
      })

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'ADMIN',
        tenant: { id: 'tenant-123', name: 'Test Company' } as any,
      })

      const mockTokens = createMockTokens()

      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      const result = await controller.spidCallback({ user: mockSpidUser })

      expect(result).toEqual({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        expiresIn: mockTokens.expiresIn,
        user: {
          id: 'user-123',
          email: 'test@example.com',
          fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
          firstName: 'Mario',
          lastName: 'Rossi',
        },
        isNewUser: false,
      })

      expect(jwtTokensService.generateTokenPair).toHaveBeenCalledWith({
        id: mockSpidUser.id,
        email: mockSpidUser.email,
        fiscalCode: mockSpidUser.fiscalCode,
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
        mockSpidUser.id,
        mockTokens.refreshToken,
        7 * 24 * 60 * 60 // 7 days in seconds
      )
    })

    it('should handle new user registration via SPID', async () => {
      const mockNewUser = createMockSpidUser({
        id: 'user-new',
        email: 'newuser@example.com',
        fiscalCode: VALID_FISCAL_CODES.LUIGI_VERDI,
        firstName: 'Luigi',
        lastName: 'Verdi',
        isNewUser: true,
      })

      const mockDbUser = createMockUser({
        id: 'user-new',
        email: 'newuser@example.com',
        fiscalCode: VALID_FISCAL_CODES.LUIGI_VERDI,
        tenantId: null,
        role: 'VIEWER',
      })

      const mockTokens = createMockTokens()

      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      const result = await controller.spidCallback({ user: mockNewUser })

      expect(result.isNewUser).toBe(true)
      expect(result.user.id).toBe('user-new')
    })

    it('should store refresh token in Redis', async () => {
      const mockSpidUser = createMockSpidUser()

      const mockDbUser = createMockUser({
        tenantId: 'tenant-123',
        role: 'VIEWER',
      })

      const mockTokens = createMockTokens()

      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      await controller.spidCallback({ user: mockSpidUser })

      expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
        'user-123',
        mockTokens.refreshToken,
        604800 // 7 days in seconds
      )
    })
  })

  describe('refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockRefreshToken = 'valid-refresh-token'
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh' as const,
      }

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      const mockNewAccessToken = 'new-access-token'

      jwtTokensService.verifyRefreshToken.mockReturnValue(mockPayload)
      redisService.isRefreshTokenValid.mockResolvedValue(true)
      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateAccessToken.mockReturnValue(mockNewAccessToken)

      const result = await controller.refresh({ refreshToken: mockRefreshToken })

      expect(result).toEqual({
        accessToken: 'new-access-token',
        expiresIn: 900,
      })

      expect(jwtTokensService.verifyRefreshToken).toHaveBeenCalledWith(mockRefreshToken)
      expect(redisService.isRefreshTokenValid).toHaveBeenCalledWith('user-123', mockRefreshToken)
    })

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      const mockRefreshToken = 'invalid-refresh-token'

      jwtTokensService.verifyRefreshToken.mockReturnValue(null)

      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        UnauthorizedException
      )
      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        'Invalid refresh token'
      )
    })

    it('should throw UnauthorizedException if refresh token is revoked', async () => {
      const mockRefreshToken = 'revoked-refresh-token'
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh' as const,
      }

      jwtTokensService.verifyRefreshToken.mockReturnValue(mockPayload)
      redisService.isRefreshTokenValid.mockResolvedValue(false)

      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        UnauthorizedException
      )
      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        'Refresh token has been revoked'
      )
    })

    it('should generate new access token for valid refresh', async () => {
      const mockRefreshToken = 'valid-refresh-token'
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh' as const,
      }

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'OPERATOR',
      })

      jwtTokensService.verifyRefreshToken.mockReturnValue(mockPayload)
      redisService.isRefreshTokenValid.mockResolvedValue(true)
      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateAccessToken.mockReturnValue('new-access-token')

      await controller.refresh({ refreshToken: mockRefreshToken })

      expect(jwtTokensService.generateAccessToken).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'OPERATOR',
      })
    })
  })

  describe('logout', () => {
    it('should revoke refresh token and access token', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
        headers: {
          authorization: 'Bearer access-token-123',
        },
      }

      jwtTokensService.extractTokenFromHeader.mockReturnValue('access-token-123')
      redisService.revokeRefreshToken.mockResolvedValue()
      redisService.revokeAccessToken.mockResolvedValue()

      const result = await controller.logout(mockRequest, {
        refreshToken: 'refresh-token-456',
      })

      expect(result).toEqual({ message: 'Logged out successfully' })

      expect(jwtTokensService.extractTokenFromHeader).toHaveBeenCalledWith(
        'Bearer access-token-123'
      )
      expect(redisService.revokeRefreshToken).toHaveBeenCalledWith('user-123', 'refresh-token-456')
      expect(redisService.revokeAccessToken).toHaveBeenCalledWith('access-token-123', 900)
    })

    it('should handle logout without access token in header', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
        headers: {},
      }

      jwtTokensService.extractTokenFromHeader.mockReturnValue(null)
      redisService.revokeRefreshToken.mockResolvedValue()

      const result = await controller.logout(mockRequest, {
        refreshToken: 'refresh-token-456',
      })

      expect(result).toEqual({ message: 'Logged out successfully' })
      expect(redisService.revokeRefreshToken).toHaveBeenCalledWith('user-123', 'refresh-token-456')
      expect(redisService.revokeAccessToken).not.toHaveBeenCalled()
    })

    it('should revoke both tokens when both are provided', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
        headers: {
          authorization: 'Bearer access-token-123',
        },
      }

      jwtTokensService.extractTokenFromHeader.mockReturnValue('access-token-123')
      redisService.revokeRefreshToken.mockResolvedValue()
      redisService.revokeAccessToken.mockResolvedValue()

      await controller.logout(mockRequest, {
        refreshToken: 'refresh-token-456',
      })

      expect(redisService.revokeRefreshToken).toHaveBeenCalled()
      expect(redisService.revokeAccessToken).toHaveBeenCalled()
    })
  })

  describe('getProfile', () => {
    it('should return current user profile', () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        role: 'ADMIN',
        tenantId: 'tenant-123',
        permissions: [],
      }

      const mockRequest = {
        user: mockUser,
      }

      const result = controller.getProfile(mockRequest)

      expect(result).toEqual(mockUser)
    })
  })
})
