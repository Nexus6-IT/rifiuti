import { IsString, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/**
 * Refresh Token Request DTO
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token from login response',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string
}

/**
 * Login Response DTO
 */
export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string

  @ApiProperty({
    description: 'JWT refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string

  @ApiProperty({
    description: 'Token expiry time in seconds',
    example: 3600,
  })
  expiresIn: number

  @ApiProperty({
    description: 'Authenticated user information',
  })
  user: UserDto
}

/**
 * User DTO
 */
export class UserDto {
  @ApiProperty({
    description: 'User ID',
    example: 'user-123',
  })
  id: string

  @ApiProperty({
    description: 'Italian fiscal code',
    example: 'RSSMRA80A01H501U',
  })
  fiscalCode: string

  @ApiProperty({
    description: 'First name',
    example: 'Mario',
  })
  firstName: string

  @ApiProperty({
    description: 'Last name',
    example: 'Rossi',
  })
  lastName: string

  @ApiProperty({
    description: 'Full name',
    example: 'Mario Rossi',
  })
  fullName: string

  @ApiProperty({
    description: 'Email address',
    example: 'mario.rossi@example.it',
  })
  email: string

  @ApiProperty({
    description: 'Tenant ID',
    example: 'tenant-123',
  })
  tenantId: string

  @ApiProperty({
    description: 'SPID authentication level (0-3)',
    example: 2,
  })
  spidLevel: number

  @ApiProperty({
    description: 'Can sign FIR documents',
    example: true,
  })
  canSignDocuments: boolean

  @ApiProperty({
    description: 'User roles',
    example: ['USER', 'OPERATOR'],
  })
  roles: string[]
}

/**
 * Session Info DTO
 */
export class SessionInfoDto {
  @ApiProperty({
    description: 'User information',
  })
  user: {
    id: string
    fiscalCode: string
    firstName: string
    lastName: string
    fullName: string
    email: string
    tenantId: string
    roles: string[]
    isActive: boolean
  }

  @ApiProperty({
    description: 'SPID authentication information (if available)',
    required: false,
  })
  spid?: {
    level: number
    issuer: string
    sessionId: string
    authenticatedAt: Date
    authExpiry: Date
    isAuthRecent: boolean
  }

  @ApiProperty({
    description: 'Authorization capabilities',
  })
  authorization: {
    canSignDocuments: boolean
    insufficientSpidLevel: boolean
    spidAuthExpired: boolean
  }

  @ApiProperty({
    description: 'Session information',
  })
  session: {
    expiry: Date
    issuedAt: Date
  }
}

/**
 * SPID Auth Status DTO
 */
export class SpidAuthStatusDto {
  @ApiProperty({
    description: 'Has SPID authentication',
    example: true,
  })
  hasSpidAuth: boolean

  @ApiProperty({
    description: 'SPID level (0-3)',
    example: 2,
  })
  spidLevel: number

  @ApiProperty({
    description: 'Authentication is recent (<15 minutes)',
    example: true,
  })
  isAuthRecent: boolean

  @ApiProperty({
    description: 'Can sign documents now',
    example: true,
  })
  canSignDocuments: boolean

  @ApiProperty({
    description: 'Status reason code',
    enum: ['OK', 'NO_SPID_AUTH', 'INSUFFICIENT_SPID_LEVEL', 'SPID_AUTH_EXPIRED'],
    example: 'OK',
  })
  reason: string

  @ApiProperty({
    description: 'Human-readable status message',
    example: 'SPID authentication valid',
  })
  message: string

  @ApiProperty({
    description: 'Requires re-authentication',
    example: false,
  })
  requiresReAuth: boolean

  @ApiProperty({
    description: 'Requires SPID level upgrade',
    example: false,
    required: false,
  })
  requiresLevelUpgrade?: boolean

  @ApiProperty({
    description: 'Identity provider URL',
    example: 'https://identity.infocert.it',
    required: false,
  })
  issuer?: string

  @ApiProperty({
    description: 'SPID session ID',
    example: 'session-123',
    required: false,
  })
  sessionId?: string

  @ApiProperty({
    description: 'When authenticated',
    example: '2025-10-19T10:00:00Z',
    required: false,
  })
  authenticatedAt?: Date

  @ApiProperty({
    description: 'When authentication expires',
    example: '2025-10-19T10:15:00Z',
    required: false,
  })
  authExpiresAt?: Date

  @ApiProperty({
    description: 'Minutes remaining until auth expires',
    example: 12,
    required: false,
  })
  minutesRemaining?: number

  @ApiProperty({
    description: 'Warning threshold (<5 minutes remaining)',
    example: false,
    required: false,
  })
  warningThreshold?: boolean
}
