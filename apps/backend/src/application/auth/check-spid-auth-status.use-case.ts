import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { UserRepository } from '../../infrastructure/persistence/user.repository'

/**
 * Check SPID Auth Status Use Case
 *
 * Checks user's SPID authentication status to determine if they can
 * perform signature operations.
 *
 * Used by frontend to:
 * - Show warning when SPID auth is about to expire
 * - Prompt re-authentication before signature operations
 * - Display upgrade message for Level 1 users
 *
 * Business Rules:
 * - SPID Level 2+ required for signatures
 * - Authentication must be recent (<15 minutes)
 * - Provides time remaining until auth expires
 */
@Injectable()
export class CheckSpidAuthStatusUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('CheckSpidAuthStatusUseCase')
  }

  /**
   * Execute SPID auth status check
   */
  async execute(userId: string): Promise<SpidAuthStatus> {
    this.logger.debug('Checking SPID auth status', { userId })

    try {
      const user = await this.userRepository.findById(userId)

      if (!user) {
        throw new Error(`User not found: ${userId}`)
      }

      const spidAttributes = user.getSpidAttributes()

      // No SPID authentication
      if (!spidAttributes) {
        return {
          hasSpidAuth: false,
          spidLevel: 0,
          isAuthRecent: false,
          canSignDocuments: false,
          reason: 'NO_SPID_AUTH',
          message: 'SPID authentication required',
          requiresReAuth: true,
        }
      }

      const spidLevel = spidAttributes.getSpidLevel()
      const isAuthRecent = spidAttributes.isAuthenticationRecent()
      const _canSignDocuments = user.canSignDocuments()
      const authenticatedAt = spidAttributes.getAuthenticatedAt()

      // Calculate time remaining until auth expires
      const now = new Date()
      const authExpiresAt = new Date(authenticatedAt.getTime() + 15 * 60 * 1000)
      const minutesRemaining = Math.max(
        0,
        Math.floor((authExpiresAt.getTime() - now.getTime()) / 60000)
      )

      // SPID Level insufficient (Level 1)
      if (spidLevel < 2) {
        return {
          hasSpidAuth: true,
          spidLevel,
          isAuthRecent,
          canSignDocuments: false,
          reason: 'INSUFFICIENT_SPID_LEVEL',
          message: 'SPID Level 2 or higher required for signing documents',
          requiresReAuth: true,
          requiresLevelUpgrade: true,
          issuer: spidAttributes.getIssuer(),
          authenticatedAt,
          authExpiresAt,
          minutesRemaining,
        }
      }

      // SPID auth expired (>15 minutes)
      if (!isAuthRecent) {
        return {
          hasSpidAuth: true,
          spidLevel,
          isAuthRecent: false,
          canSignDocuments: false,
          reason: 'SPID_AUTH_EXPIRED',
          message: 'SPID authentication expired. Please re-authenticate to sign documents.',
          requiresReAuth: true,
          issuer: spidAttributes.getIssuer(),
          authenticatedAt,
          authExpiresAt,
          minutesRemaining: 0,
        }
      }

      // SPID auth valid and sufficient
      return {
        hasSpidAuth: true,
        spidLevel,
        isAuthRecent: true,
        canSignDocuments: true,
        reason: 'OK',
        message: 'SPID authentication valid',
        requiresReAuth: false,
        issuer: spidAttributes.getIssuer(),
        sessionId: spidAttributes.getSessionId(),
        authenticatedAt,
        authExpiresAt,
        minutesRemaining,
        warningThreshold: minutesRemaining < 5, // Warn when <5 minutes remaining
      }
    } catch (error: any) {
      this.logger.error('Failed to check SPID auth status', error, { userId })
      throw error
    }
  }
}

/**
 * SPID Auth Status Response
 */
export interface SpidAuthStatus {
  hasSpidAuth: boolean
  spidLevel: number
  isAuthRecent: boolean
  canSignDocuments: boolean
  reason: 'OK' | 'NO_SPID_AUTH' | 'INSUFFICIENT_SPID_LEVEL' | 'SPID_AUTH_EXPIRED'
  message: string
  requiresReAuth: boolean
  requiresLevelUpgrade?: boolean
  issuer?: string
  sessionId?: string
  authenticatedAt?: Date
  authExpiresAt?: Date
  minutesRemaining?: number
  warningThreshold?: boolean // True if auth expires in <5 minutes
}
