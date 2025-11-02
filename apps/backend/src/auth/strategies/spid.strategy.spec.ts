/**
 * SPID SAML Strategy - TDD Tests
 * Passport strategy for SPID authentication via SAML
 */

import { SpidStrategy } from './spid.strategy'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { UnauthorizedException } from '@nestjs/common'
import { createPrismaMock, MockPrisma } from '../../../test/utils/prisma-mock'
import { createConfigServiceMock, MockConfigService } from '../../../test/utils/config-service-mock.factory'
import { createMockUser, createMockSpidProfile, VALID_FISCAL_CODES } from '../../../test/utils/test-fixtures.factory'

describe('SpidStrategy', () => {
  let strategy: SpidStrategy
  let configService: MockConfigService
  let prismaService: MockPrisma

  beforeEach(() => {
    configService = createConfigServiceMock()
    prismaService = createPrismaMock()

    strategy = new SpidStrategy(configService, prismaService as any)
  })

  describe('validate', () => {
    it('should return existing user if found', async () => {
      const mockProfile = createMockSpidProfile({
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        email: 'mario.rossi@example.com',
        name: 'Mario',
        familyName: 'Rossi',
      })

      const existingUser = createMockUser({
        id: 'user-existing-123',
        email: 'mario.rossi@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        firstName: 'Mario',
        lastName: 'Rossi',
      })

      prismaService.user.findMany.mockResolvedValue([existingUser] as any)

      const result = await strategy.validate(mockProfile)

      expect(result).toEqual({
        id: 'user-existing-123',
        email: 'mario.rossi@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        firstName: 'Mario',
        lastName: 'Rossi',
        isNewUser: false,
      })
    })

    it('should search user by fiscalCode using findMany', async () => {
      const mockProfile = createMockSpidProfile()
      const mockUser = createMockUser()

      prismaService.user.findMany.mockResolvedValue([mockUser] as any)

      await strategy.validate(mockProfile)

      expect(prismaService.user.findMany).toHaveBeenCalledWith({
        where: { fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI },
        take: 1,
      })
    })

    it('should throw UnauthorizedException if user not found', async () => {
      const mockProfile = createMockSpidProfile()

      // User does not exist - should reject
      prismaService.user.findMany.mockResolvedValue([])

      await expect(strategy.validate(mockProfile)).rejects.toThrow(UnauthorizedException)
      await expect(strategy.validate(mockProfile)).rejects.toThrow('User not found')
    })

    it('should extract fiscal code from SPID profile', async () => {
      const mockProfile = createMockSpidProfile({
        fiscalCode: VALID_FISCAL_CODES.LUIGI_VERDI,
      })

      const mockUser = createMockUser({
        fiscalCode: VALID_FISCAL_CODES.LUIGI_VERDI,
      })

      prismaService.user.findMany.mockResolvedValue([mockUser] as any)

      const result = await strategy.validate(mockProfile)

      expect(result.fiscalCode).toBe(VALID_FISCAL_CODES.LUIGI_VERDI)
    })

    it('should handle SPID profile with minimal attributes', async () => {
      const minimalProfile = {
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        email: 'mario.rossi@example.com',
      }

      const mockUser = createMockUser({
        email: 'mario.rossi@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        firstName: null,
        lastName: null,
      })

      prismaService.user.findMany.mockResolvedValue([mockUser] as any)

      const result = await strategy.validate(minimalProfile as any)

      expect(result.firstName).toBeUndefined()
      expect(result.lastName).toBeUndefined()
    })

    it('should throw UnauthorizedException if fiscalCode is missing', async () => {
      const invalidProfile = {
        email: 'test@example.com',
      }

      await expect(strategy.validate(invalidProfile as any)).rejects.toThrow(UnauthorizedException)
      await expect(strategy.validate(invalidProfile as any)).rejects.toThrow('Missing required SPID attributes')
    })

    it('should throw UnauthorizedException if email is missing', async () => {
      const invalidProfile = {
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
      }

      await expect(strategy.validate(invalidProfile as any)).rejects.toThrow(UnauthorizedException)
      await expect(strategy.validate(invalidProfile as any)).rejects.toThrow('Missing required SPID attributes')
    })

    it('should handle user with all optional fields', async () => {
      const fullProfile = createMockSpidProfile({
        fiscalCode: VALID_FISCAL_CODES.ANNA_RUSSO,
        email: 'anna.russo@example.com',
        name: 'Anna',
        familyName: 'Russo',
      })

      const mockUser = createMockUser({
        fiscalCode: VALID_FISCAL_CODES.ANNA_RUSSO,
        email: 'anna.russo@example.com',
        firstName: 'Anna',
        lastName: 'Russo',
      })

      prismaService.user.findMany.mockResolvedValue([mockUser] as any)

      const result = await strategy.validate(fullProfile)

      expect(result).toMatchObject({
        fiscalCode: VALID_FISCAL_CODES.ANNA_RUSSO,
        email: 'anna.russo@example.com',
        firstName: 'Anna',
        lastName: 'Russo',
        isNewUser: false,
      })
    })
  })

  describe('constructor', () => {
    it('should configure SAML options from config', () => {
      expect(configService.get).toHaveBeenCalledWith('SPID_ENTITY_ID')
      expect(configService.get).toHaveBeenCalledWith('SPID_CALLBACK_URL')
    })

    it('should set SAML authentication strategy', () => {
      expect(strategy).toBeDefined()
    })
  })
})
