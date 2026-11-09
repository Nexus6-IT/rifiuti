/**
 * Dev Auth Controller - TDD Tests
 * Endpoint di bypass SPID per lo sviluppo locale.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { DevAuthController } from './dev-auth.controller'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { ConfigService } from '@nestjs/config'
import { TenantContext } from '../../core/context/tenant-context'
import { createPrismaMock, MockPrisma } from '../../../test/utils/prisma-mock'
import {
  createConfigServiceMock,
  MockConfigService,
} from '../../../test/utils/config-service-mock.factory'
import { createMockUser, createMockTokens } from '../../../test/utils/test-fixtures.factory'

describe('DevAuthController', () => {
  let controller: DevAuthController
  let jwtTokensService: jest.Mocked<JwtTokensService>
  let redisService: jest.Mocked<RedisService>
  let prismaService: MockPrisma
  let configService: MockConfigService

  beforeEach(async () => {
    const mockJwtTokensService = {
      generateTokenPair: jest.fn(),
    }

    const mockRedisService = {
      storeRefreshToken: jest.fn(),
    }

    prismaService = createPrismaMock()
    configService = createConfigServiceMock()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevAuthController],
      providers: [
        { provide: JwtTokensService, useValue: mockJwtTokensService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: PrismaSistemaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile()

    controller = module.get<DevAuthController>(DevAuthController)
    jwtTokensService = module.get(JwtTokensService)
    redisService = module.get(RedisService)
  })

  it('dev login: utente cercato dal client di sistema, senza contesto', async () => {
    let tenantVisto: string | null = 'non-chiamato'
    prismaService.user.findFirst.mockImplementation((() => {
      tenantVisto = TenantContext.getStoreTenantId()
      return Promise.resolve(null)
    }) as any)

    await TenantContext.run({}, async () =>
      controller.devLogin({ email: 'a@b.it' } as any).catch(() => undefined)
    )

    expect(tenantVisto).toBeNull()
    expect(Reflect.getMetadata('design:paramtypes', DevAuthController)[2]).toBe(
      PrismaSistemaService
    )
  })

  describe('devLogin', () => {
    it('should reject when NODE_ENV is production', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'NODE_ENV') return 'production'
        return fallback
      })

      await expect(controller.devLogin({ email: 'test@example.com' })).rejects.toThrow(
        UnauthorizedException
      )
      await expect(controller.devLogin({ email: 'test@example.com' })).rejects.toThrow(
        'Dev login not available in production'
      )
    })

    it('should reject when the user does not exist', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'NODE_ENV') return 'development'
        return fallback
      })
      prismaService.user.findFirst.mockResolvedValue(null)

      await expect(controller.devLogin({ email: 'missing@example.com' })).rejects.toThrow(
        UnauthorizedException
      )
    })

    it('should issue tokens for an existing user in development', async () => {
      configService.get.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'NODE_ENV') return 'development'
        return fallback
      })

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })
      const mockTokens = createMockTokens()

      prismaService.user.findFirst.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      const result = await controller.devLogin({ email: 'test@example.com' })

      expect(result.accessToken).toBe(mockTokens.accessToken)
      expect(result.user.email).toBe('test@example.com')
      expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
        'user-123',
        mockTokens.refreshToken,
        7 * 24 * 60 * 60
      )
    })
  })

  it("non e' soggetto al throttler globale (gli e2e fanno un dev-login per utente)", () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', DevAuthController)).toBe(true)
  })
})
