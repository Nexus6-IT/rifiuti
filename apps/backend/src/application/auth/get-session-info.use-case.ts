import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { UserRepository } from '../../infrastructure/persistence/user.repository'

/**
 * Get Session Info Use Case
 *
 * Retrieves current user session information including:
 * - User identity (fiscal code, name, email)
 * - SPID authentication status and level
 * - Authorization capabilities (can sign documents)
 * - Session expiry information
 *
 * Used by frontend to:
 * - Display user info in header
 * - Show/hide signature buttons based on auth level
 * - Display session warnings when auth expires
 */
@Injectable()
export class GetSessionInfoUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('GetSessionInfoUseCase')
  }

  /**
   * Execute session info retrieval
   */
  async execute(userId: string): Promise<SessionInfo> {
    this.logger.debug('Getting session info', { userId })

    try {
      const user = await this.userRepository.findById(userId)

      if (!user) {
        throw new Error(`User not found: ${userId}`)
      }

      const spidAttributes = user.getSpidAttributes()

      // Calculate session expiry (1 hour from token issue)
      const now = new Date()
      const sessionExpiry = new Date(now.getTime() + 3600000) // 1 hour from now

      // Get SPID authentication time if available
      const spidAuthenticatedAt = spidAttributes?.getAuthenticatedAt()

      // Calculate SPID auth expiry (15 minutes for signature operations)
      const spidAuthExpiry = spidAuthenticatedAt
        ? new Date(spidAuthenticatedAt.getTime() + 15 * 60 * 1000)
        : undefined

      this.logger.debug('Session info retrieved', {
        userId,
        fiscalCode: user.getFiscalCode(),
        spidLevel: user.getSpidLevel(),
        canSignDocuments: user.canSignDocuments(),
      })

      return {
        user: {
          id: user.getId(),
          fiscalCode: user.getFiscalCode(),
          firstName: user.getFirstName(),
          lastName: user.getLastName(),
          fullName: user.getFullName(),
          email: user.getEmail(),
          tenantId: user.getTenantId(),
          roles: user.getRoles(),
          isActive: user.getIsActive(),
        },
        spid: spidAttributes
          ? {
              level: spidAttributes.getSpidLevel(),
              issuer: spidAttributes.getIssuer(),
              sessionId: spidAttributes.getSessionId(),
              authenticatedAt: spidAttributes.getAuthenticatedAt(),
              authExpiry: spidAuthExpiry!,
              isAuthRecent: spidAttributes.isAuthenticationRecent(),
            }
          : undefined,
        authorization: {
          canSignDocuments: user.canSignDocuments(),
          insufficientSpidLevel: spidAttributes ? !spidAttributes.canSignDocuments() : true,
          spidAuthExpired: spidAttributes ? !spidAttributes.isAuthenticationRecent() : true,
        },
        session: {
          expiry: sessionExpiry,
          issuedAt: now,
        },
      }
    } catch (error: any) {
      this.logger.error('Failed to get session info', error, { userId })
      throw error
    }
  }
}

/**
 * Session Info Response
 */
export interface SessionInfo {
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
  spid?: {
    level: number
    issuer: string
    sessionId: string
    authenticatedAt: Date
    authExpiry: Date
    isAuthRecent: boolean
  }
  authorization: {
    canSignDocuments: boolean
    insufficientSpidLevel: boolean
    spidAuthExpired: boolean
  }
  session: {
    expiry: Date
    issuedAt: Date
  }
}
