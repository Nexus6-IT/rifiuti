import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../core/logger/logger.service';
import { UserRepository } from '../../infrastructure/persistence/user.repository';
import { User } from '../../domain/auth/user.entity';
import { SPIDAttributes } from '../../domain/auth/spid-attributes.vo';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Handle SPID Callback Use Case
 *
 * Processes SAML callback from Keycloak after SPID/CIE authentication.
 * Creates new user or updates existing user SPID attributes.
 * Issues JWT access and refresh tokens.
 *
 * Flow:
 * 1. Validate SAML attributes
 * 2. Find or create user by fiscal code
 * 3. Update SPID authentication attributes
 * 4. Generate JWT tokens
 * 5. Return user and tokens
 *
 * Business Rules:
 * - Fiscal code from SPID must match existing user (if any)
 * - Email can be updated from SPID attributes
 * - SPID level is stored for signature authorization
 * - Session ID tracks the SPID authentication session
 */
@Injectable()
export class HandleSPIDCallbackUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('HandleSPIDCallbackUseCase');
  }

  /**
   * Execute SPID callback processing
   */
  async execute(params: {
    fiscalCode: string;
    firstName: string;
    lastName: string;
    email: string;
    spidLevel: number;
    issuer: string;
    sessionId: string;
    tenantId?: string; // Optional for new users
    correlationId?: string;
  }): Promise<SPIDCallbackResult> {
    this.logger.info('Processing SPID callback', {
      fiscalCode: params.fiscalCode,
      spidLevel: params.spidLevel,
      issuer: params.issuer,
      correlationId: params.correlationId,
    });

    try {
      // Create SPID attributes value object
      const spidAttributes = SPIDAttributes.create({
        fiscalCode: params.fiscalCode,
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
        spidLevel: params.spidLevel,
        issuer: params.issuer,
        sessionId: params.sessionId,
      });

      // Find existing user by fiscal code
      let user = await this.userRepository.findByFiscalCode(params.fiscalCode);

      if (user) {
        // Update existing user SPID attributes
        this.logger.info('Updating existing user SPID authentication', {
          userId: user.getId(),
          fiscalCode: params.fiscalCode,
          spidLevel: params.spidLevel,
        });

        user.updateSpidAuthentication(spidAttributes);
        await this.userRepository.update(user.getId(), user);
      } else {
        // Create new user
        this.logger.info('Creating new user from SPID authentication', {
          fiscalCode: params.fiscalCode,
          spidLevel: params.spidLevel,
        });

        // For new users, tenantId is required
        if (!params.tenantId) {
          throw new Error(
            'Tenant ID required for new user registration. User must be invited to a tenant first.'
          );
        }

        user = User.create({
          id: this.generateUserId(),
          fiscalCode: params.fiscalCode,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email,
          tenantId: params.tenantId,
          spidAttributes,
          roles: ['USER'], // Default role
        });

        await this.userRepository.save(user);
      }

      // Generate JWT tokens
      const tokens = this.generateTokens(user);

      this.logger.info('SPID callback processed successfully', {
        userId: user.getId(),
        fiscalCode: params.fiscalCode,
        spidLevel: params.spidLevel,
        canSignDocuments: user.canSignDocuments(),
      });

      return {
        user: {
          id: user.getId(),
          fiscalCode: user.getFiscalCode(),
          firstName: user.getFirstName(),
          lastName: user.getLastName(),
          fullName: user.getFullName(),
          email: user.getEmail(),
          tenantId: user.getTenantId(),
          spidLevel: user.getSpidLevel(),
          canSignDocuments: user.canSignDocuments(),
          roles: user.getRoles(),
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: 3600, // 1 hour
      };
    } catch (error: any) {
      this.logger.error('Failed to process SPID callback', error, {
        fiscalCode: params.fiscalCode,
        correlationId: params.correlationId,
      });

      throw error;
    }
  }

  /**
   * Generate JWT access and refresh tokens
   */
  private generateTokens(user: User): {
    accessToken: string;
    refreshToken: string;
  } {
    const payload = {
      sub: user.getId(),
      fiscalCode: user.getFiscalCode(),
      email: user.getEmail(),
      tenantId: user.getTenantId(),
      roles: user.getRoles(),
      spidLevel: user.getSpidLevel(),
      canSignDocuments: user.canSignDocuments(),
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '1h',
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.getId(), type: 'refresh' },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Generate unique user ID
   */
  private generateUserId(): string {
    return `user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}

/**
 * SPID Callback Result
 */
export interface SPIDCallbackResult {
  user: {
    id: string;
    fiscalCode: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    tenantId: string;
    spidLevel: number;
    canSignDocuments: boolean;
    roles: string[];
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
