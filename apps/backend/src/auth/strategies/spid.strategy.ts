/**
 * SPID SAML Strategy
 * Passport strategy for SPID authentication via SAML 2.0
 */

import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy, Profile } from 'passport-saml'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

export interface SpidProfile extends Profile {
  fiscalCode: string
  email: string
  name?: string
  familyName?: string
}

export interface SpidUser {
  id: string
  email: string
  fiscalCode: string
  firstName?: string
  lastName?: string
  isNewUser: boolean
}

@Injectable()
export class SpidStrategy extends PassportStrategy(Strategy, 'spid') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService
  ) {
    // Get certificate with fallback for development
    const idpCert = configService.get<string>('SPID_IDP_CERT') ||
                    configService.get<string>('SPID_PUBLIC_CERT') ||
                    // Mock certificate for development only
                    '-----BEGIN CERTIFICATE-----\nMIIDMock=\n-----END CERTIFICATE-----'

    super({
      // Service Provider (SP) configuration
      entryPoint: configService.get<string>('SPID_IDP_ENTRY_POINT') ||
                  configService.get<string>('SPID_ENTRY_POINT') ||
                  'http://localhost:8080/samlsso',
      issuer: configService.get<string>('SPID_ENTITY_ID') ||
              configService.get<string>('SPID_ISSUER') ||
              'wasteflow-dev',
      callbackUrl: configService.get<string>('SPID_CALLBACK_URL') ||
                   'http://localhost:3000/auth/spid/callback',

      // Identity Provider (IdP) configuration
      cert: idpCert,

      // SP certificate for signing requests
      privateCert: configService.get<string>('SPID_PRIVATE_KEY'),
      decryptionPvk: configService.get<string>('SPID_PRIVATE_KEY'),

      // SPID-specific SAML attributes
      identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
      authnContext: [
        'https://www.spid.gov.it/SpidL1',
        'https://www.spid.gov.it/SpidL2',
        'https://www.spid.gov.it/SpidL3',
      ],

      // Attribute mapping
      attributeConsumingServiceIndex: '0',
      acceptedClockSkewMs: -1,
      // Keycloak (IdP) non e' un IdP SPID: non inviare l'AuthnContext SPID
      // (L1/L2/L3), altrimenti la richiesta verrebbe rifiutata/ignorata.
      disableRequestedAuthnContext: true,

      // Security
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
    })
  }

  /**
   * Validate SPID profile and create/update user
   */
  async validate(profile: SpidProfile): Promise<SpidUser> {
    // 1. Extract SPID attributes
    const fiscalCode = profile.fiscalCode
    const email = profile.email
    const firstName = profile.name
    const lastName = profile.familyName

    if (!fiscalCode || !email) {
      throw new UnauthorizedException('Missing required SPID attributes: fiscalCode or email')
    }

    // 2. Find user by fiscalCode (need to search across tenantId combinations)
    // Since fiscalCode is unique per tenant, we need to find first occurrence
    const users = await this.prismaService.user.findMany({
      where: { fiscalCode },
      take: 1,
    })

    let user = users.length > 0 ? users[0] : null

    let isNewUser = false

    if (!user) {
      // User does not exist - SPID login should only work for existing users
      // In production, users must be created by admin first
      throw new UnauthorizedException('User not found. Please contact your administrator to set up your account.')
    }

    return {
      id: user.id,
      email: user.email,
      fiscalCode: user.fiscalCode,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
      isNewUser,
    }
  }
}
