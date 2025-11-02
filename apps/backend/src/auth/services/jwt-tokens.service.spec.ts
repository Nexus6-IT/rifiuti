/**
 * JWT Tokens Service - TDD Tests
 * Handles access and refresh token generation/validation
 */

import { JwtTokensService } from './jwt-tokens.service'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'

describe('JwtTokensService', () => {
  let service: JwtTokensService
  let jwtService: jest.Mocked<JwtService>
  let configService: jest.Mocked<ConfigService>

  const mockUser = {
    id: 'user-123',
    email: 'mario.rossi@example.com',
    fiscalCode: 'RSSMRA80A01H501Z',
    tenantId: 'tenant-123',
    role: 'ADMIN',
  }

  beforeEach(() => {
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    } as any

    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          JWT_SECRET: 'test-secret-key-12345',
          JWT_ACCESS_TOKEN_EXPIRATION: '15m',
          JWT_REFRESH_TOKEN_EXPIRATION: '7d',
        }
        return config[key]
      }),
    } as any

    service = new JwtTokensService(jwtService, configService)
  })

  describe('generateAccessToken', () => {
    it('should generate access token with user payload', () => {
      jwtService.sign.mockReturnValue('mock-access-token')

      const token = service.generateAccessToken(mockUser)

      expect(token).toBe('mock-access-token')
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'user-123',
          email: 'mario.rossi@example.com',
          fiscalCode: 'RSSMRA80A01H501Z',
          tenantId: 'tenant-123',
          role: 'ADMIN',
          type: 'access',
        },
        { expiresIn: '15m' }
      )
    })

    it('should include type field as "access"', () => {
      jwtService.sign.mockReturnValue('token')

      service.generateAccessToken(mockUser)

      expect(jwtService.sign).toHaveBeenCalledWith(
        (expect as any).objectContaining({ type: 'access' }),
        (expect as any).anything()
      )
    })
  })

  describe('generateRefreshToken', () => {
    it('should generate refresh token with minimal payload', () => {
      jwtService.sign.mockReturnValue('mock-refresh-token')

      const token = service.generateRefreshToken('user-123')

      expect(token).toBe('mock-refresh-token')
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'user-123',
          type: 'refresh',
        },
        { expiresIn: '7d' }
      )
    })

    it('should include type field as "refresh"', () => {
      jwtService.sign.mockReturnValue('token')

      service.generateRefreshToken('user-123')

      expect(jwtService.sign).toHaveBeenCalledWith(
        (expect as any).objectContaining({ type: 'refresh' }),
        (expect as any).anything()
      )
    })
  })

  describe('generateTokenPair', () => {
    it('should generate both access and refresh tokens', () => {
      jwtService.sign
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock')

      const tokens = service.generateTokenPair(mockUser)

      expect(tokens).toEqual({
        accessToken: 'access-token-mock',
        refreshToken: 'refresh-token-mock',
        expiresIn: 900, // 15 minutes in seconds
      })
    })

    it('should call generateAccessToken and generateRefreshToken', () => {
      jwtService.sign.mockReturnValue('token')

      service.generateTokenPair(mockUser)

      expect(jwtService.sign).toHaveBeenCalledTimes(2)
    })
  })

  describe('verifyAccessToken', () => {
    it('should verify and decode valid access token', () => {
      const mockPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        type: 'access',
      }
      jwtService.verify.mockReturnValue(mockPayload)

      const payload = service.verifyAccessToken('valid-token')

      expect(payload).toEqual(mockPayload)
      expect(jwtService.verify).toHaveBeenCalledWith('valid-token')
    })

    it('should return null for invalid token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token')
      })

      const payload = service.verifyAccessToken('invalid-token')

      expect(payload).toBeNull()
    })

    it('should return null for expired token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Token expired')
      })

      const payload = service.verifyAccessToken('expired-token')

      expect(payload).toBeNull()
    })
  })

  describe('verifyRefreshToken', () => {
    it('should verify and decode valid refresh token', () => {
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh',
      }
      jwtService.verify.mockReturnValue(mockPayload)

      const payload = service.verifyRefreshToken('valid-refresh-token')

      expect(payload).toEqual(mockPayload)
      expect(jwtService.verify).toHaveBeenCalledWith('valid-refresh-token')
    })

    it('should return null for invalid refresh token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token')
      })

      const payload = service.verifyRefreshToken('invalid-token')

      expect(payload).toBeNull()
    })

    it('should reject access token when verifying refresh token', () => {
      const mockPayload = {
        sub: 'user-123',
        type: 'access', // Wrong type
      }
      jwtService.verify.mockReturnValue(mockPayload)

      const payload = service.verifyRefreshToken('access-token')

      expect(payload).toBeNull()
    })
  })

  describe('decodeToken', () => {
    it('should decode token without verification', () => {
      const mockPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        iat: 1234567890,
        exp: 1234567900,
      }
      jwtService.verify.mockReturnValue(mockPayload)

      const decoded = service.decodeToken('some-token')

      expect(decoded).toEqual(mockPayload)
    })

    it('should return null for malformed token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Malformed token')
      })

      const decoded = service.decodeToken('malformed')

      expect(decoded).toBeNull()
    })
  })

  describe('extractTokenFromHeader', () => {
    it('should extract token from Bearer header', () => {
      const header = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

      const token = service.extractTokenFromHeader(header)

      expect(token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')
    })

    it('should return null for header without Bearer', () => {
      const header = 'Basic dXNlcjpwYXNz'

      const token = service.extractTokenFromHeader(header)

      expect(token).toBeNull()
    })

    it('should return null for empty header', () => {
      const token = service.extractTokenFromHeader('')

      expect(token).toBeNull()
    })

    it('should return null for undefined header', () => {
      const token = service.extractTokenFromHeader(undefined)

      expect(token).toBeNull()
    })
  })
})
