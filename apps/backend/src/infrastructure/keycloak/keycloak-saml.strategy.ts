import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as SamlStrategy } from 'passport-saml';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../core/logger/logger.service';
import { UserRepository } from '../persistence/user.repository';
import { HandleSPIDCallbackUseCase } from '../../application/auth/handle-spid-callback.use-case';
import { DomainException } from '../../domain/shared/domain-exception';

/**
 * Keycloak SAML Strategy
 *
 * Passport.js strategy for handling SAML authentication via Keycloak.
 * Processes SAML assertions from SPID/CIE identity providers.
 *
 * SAML Flow:
 * 1. User initiates login → redirect to Keycloak
 * 2. Keycloak redirects to SPID provider selection
 * 3. User authenticates with SPID
 * 4. SPID sends SAML assertion to Keycloak
 * 5. Keycloak validates and forwards to our callback
 * 6. This strategy validates SAML response
 * 7. User is created/updated in our system
 *
 * SAML Attributes from SPID:
 * - fiscalCode (or fiscalNumber)
 * - name (or givenName)
 * - familyName (or surname)
 * - email (or emailAddress)
 * - spidCode (or spidLevel): 1, 2, or 3
 */
@Injectable()
export class KeycloakSamlStrategy extends PassportStrategy(SamlStrategy, 'saml') {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly userRepository: UserRepository,
    private readonly handleSPIDCallbackUseCase: HandleSPIDCallbackUseCase,
  ) {
    super({
      callbackUrl: configService.get<string>('SAML_CALLBACK_URL'),
      entryPoint: `${configService.get<string>('KEYCLOAK_URL')}/realms/${configService.get<string>('KEYCLOAK_REALM')}/protocol/saml`,
      issuer: configService.get<string>('SAML_ISSUER') || 'wasteflow-backend',
      cert: configService.get<string>('SAML_CERT'),
      acceptedClockSkewMs: 5000, // 5 second clock skew tolerance
    });

    this.logger.setContext('KeycloakSamlStrategy');
  }

  /**
   * Validate SAML profile and create/update user
   *
   * Called by Passport when SAML assertion is received
   */
  async validate(profile: any, done: any): Promise<any> {
    this.logger.info('Validating SAML profile', {
      issuer: profile.issuer,
      nameID: profile.nameID,
      sessionIndex: profile.sessionIndex,
    });

    try {
      // Extract SAML attributes with multiple naming conventions
      const attributes = profile.attributes || profile;

      const fiscalCode =
        attributes.fiscalCode ||
        attributes.fiscalNumber ||
        attributes.fiscalcode ||
        profile.nameID;

      const firstName =
        attributes.name ||
        attributes.givenName ||
        attributes.firstName;

      const lastName =
        attributes.familyName ||
        attributes.surname ||
        attributes.lastName;

      const email =
        attributes.email ||
        attributes.emailAddress ||
        attributes.mail;

      const spidLevelStr =
        attributes.spidCode ||
        attributes.spidLevel ||
        attributes.authLevel ||
        '2'; // Default to Level 2

      const spidLevel = parseInt(spidLevelStr, 10);

      // Validate required attributes
      if (!fiscalCode) {
        throw DomainException.validationFailed(
          'MISSING_FISCAL_CODE',
          'Fiscal code not found in SAML assertion'
        );
      }

      if (!firstName || !lastName) {
        throw DomainException.validationFailed(
          'MISSING_NAME',
          'First name and last name required'
        );
      }

      if (!email) {
        throw DomainException.validationFailed(
          'MISSING_EMAIL',
          'Email not found in SAML assertion'
        );
      }

      this.logger.info('SAML attributes extracted', {
        fiscalCode,
        firstName,
        lastName,
        email,
        spidLevel,
        issuer: profile.issuer,
      });

      // Handle SPID callback via use case
      const result = await this.handleSPIDCallbackUseCase.execute({
        fiscalCode,
        firstName,
        lastName,
        email,
        spidLevel,
        issuer: profile.issuer,
        sessionId: profile.sessionIndex,
        // For new users, tenantId will need to be determined
        // This could come from invitation token or default tenant
        tenantId: this.getDefaultTenantId(),
      });

      this.logger.info('SAML authentication successful', {
        userId: result.user.id,
        fiscalCode: result.user.fiscalCode,
        spidLevel: result.user.spidLevel,
        canSignDocuments: result.user.canSignDocuments,
      });

      // Return user for Passport
      return done(null, result);
    } catch (error: any) {
      this.logger.error('SAML validation failed', error, {
        issuer: profile.issuer,
        sessionIndex: profile.sessionIndex,
      });

      return done(error, null);
    }
  }

  /**
   * Get default tenant ID for new users
   * In production, this would come from invitation or organization mapping
   */
  private getDefaultTenantId(): string {
    return this.configService.get<string>('DEFAULT_TENANT_ID') || 'default-tenant';
  }
}
