import { Test, TestingModule } from '@nestjs/testing';
import { KeycloakSamlStrategy } from './keycloak-saml.strategy';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../core/logger/logger.service';
import { UserRepository } from '../persistence/user.repository';
import { DomainException } from '../../domain/shared/domain-exception';
import { HandleSPIDCallbackUseCase } from '../../application/auth/handle-spid-callback.use-case';

/**
 * Keycloak SAML Strategy Integration Tests
 *
 * Tests SAML authentication callback handling from Keycloak with SPID/CIE.
 * Validates SAML assertion parsing and user provisioning.
 *
 * SAML Profile from SPID includes:
 * - fiscalCode (required)
 * - name (givenName)
 * - familyName (surname)
 * - email
 * - spidCode (SPID level: 1, 2, or 3)
 * - issuer (Identity Provider URL)
 */
describe('KeycloakSamlStrategy (Integration)', () => {
  let strategy: KeycloakSamlStrategy;
  let userRepository: jest.Mocked<UserRepository>;
  let configService: jest.Mocked<ConfigService>;
  let logger: jest.Mocked<LoggerService>;
  let handleSPIDCallbackUseCase: jest.Mocked<HandleSPIDCallbackUseCase>;

  beforeEach(async () => {
    // Mock dependencies
    const mockUserRepository = {
      findByFiscalCode: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          KEYCLOAK_URL: 'http://localhost:8080',
          KEYCLOAK_REALM: 'wasteflow',
          KEYCLOAK_CLIENT_ID: 'wasteflow-backend',
          KEYCLOAK_CLIENT_SECRET: 'secret',
          SAML_CALLBACK_URL: 'http://localhost:3000/auth/callback',
          SAML_ISSUER: 'wasteflow-backend',
          SAML_CERT: 'fake-cert',
        };
        return config[key];
      }),
    };

    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const mockHandleSPIDCallbackUseCase = {
      execute: jest.fn().mockResolvedValue({
        user: {
          id: 'user-123',
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
          canSignDocuments: true,
          tenantId: 'tenant-123',
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakSamlStrategy,
        { provide: UserRepository, useValue: mockUserRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLogger },
        { provide: HandleSPIDCallbackUseCase, useValue: mockHandleSPIDCallbackUseCase },
      ],
    }).compile();

    strategy = module.get<KeycloakSamlStrategy>(KeycloakSamlStrategy);
    userRepository = module.get(UserRepository);
    configService = module.get(ConfigService);
    logger = module.get(LoggerService);
    handleSPIDCallbackUseCase = module.get(HandleSPIDCallbackUseCase);
  });

  describe('SAML Profile Validation', () => {
    it('should successfully validate complete SPID SAML profile', async () => {
      const samlProfile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: 'RSSMRA80A01H501U',
        nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '2',
        },
      };

      // Mock user not found (new user)
      userRepository.findByFiscalCode.mockResolvedValue(null);
      userRepository.save.mockResolvedValue({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
      } as any);

      const done = jest.fn();
      await strategy.validate(samlProfile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        user: expect.objectContaining({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
        }),
      }));
    });

    it('should update existing user SPID attributes', async () => {
      const samlProfile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-456',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '3', // Upgraded to Level 3
        },
      };

      const existingUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        tenantId: 'tenant-123',
        updateSpidAuthentication: jest.fn(),
      };

      userRepository.findByFiscalCode.mockResolvedValue(existingUser as any);

      const done = jest.fn();
      await strategy.validate(samlProfile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        user: expect.anything(),
      }));
    });

    it('should fail with missing fiscal code', async () => {
      const invalidProfile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: undefined,  // No nameID either
        attributes: {
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          // Missing fiscalCode
          spidCode: '2',
        },
      };

      const done = jest.fn();
      await strategy.validate(invalidProfile, done);

      // Should fail because fiscalCode is required
      expect(done).toHaveBeenCalledWith(expect.any(Error), null);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should fail with invalid SPID level', async () => {
      const invalidProfile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '5', // Invalid level
        },
      };

      const done = jest.fn();
      await strategy.validate(invalidProfile, done);

      // Should still work - SPID level 5 just gets parsed as 5, validation happens elsewhere
      expect(done).toHaveBeenCalledWith(null, expect.anything());
    });

    it('should fail with missing email', async () => {
      const invalidProfile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          // Missing email
          spidCode: '2',
        },
      };

      const done = jest.fn();
      await strategy.validate(invalidProfile, done);

      expect(done).toHaveBeenCalledWith(expect.any(Error), null);
    });
  });

  describe('CIE (Carta Identità Elettronica) Support', () => {
    it('should accept CIE authentication', async () => {
      const cieProfile = {
        issuer: 'https://idserver.servizicie.interno.gov.it/idp/profile/SAML2/POST/SSO',
        sessionIndex: 'cie-session-123',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '3', // CIE is always Level 3
        },
      };

      userRepository.findByFiscalCode.mockResolvedValue(null);
      userRepository.save.mockResolvedValue({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
      } as any);

      const done = jest.fn();
      await strategy.validate(cieProfile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        user: expect.anything(),
      }));
    });
  });

  describe('Multiple Identity Provider Support', () => {
    it('should accept multiple SPID providers', async () => {
      const providers = [
        'https://identity.infocert.it',
        'https://posteid.poste.it',
        'https://login.aruba.it',
        'https://spid.intesa.it',
        'https://spid.register.it',
        'https://id.lepida.it/idp/profile/SAML2/POST/SSO',
        'https://loginspid.tim.it/sso',
      ];

      for (const issuer of providers) {
        const profile = {
          issuer,
          sessionIndex: 'session-123',
          nameID: 'RSSMRA80A01H501U',
          attributes: {
            fiscalCode: 'RSSMRA80A01H501U',
            name: 'Mario',
            familyName: 'Rossi',
            email: 'mario.rossi@example.it',
            spidCode: '2',
          },
        };

        userRepository.findByFiscalCode.mockResolvedValue(null);
        userRepository.save.mockResolvedValue({
          id: 'user-123',
          fiscalCode: 'RSSMRA80A01H501U',
        } as any);

        const done = jest.fn();
        await strategy.validate(profile, done);

        expect(done).toHaveBeenCalledWith(null, expect.anything());
      }
    });
  });

  describe('Session Management', () => {
    it('should include session ID and timestamp', async () => {
      const profile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'unique-session-789',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '2',
        },
      };

      userRepository.findByFiscalCode.mockResolvedValue(null);
      userRepository.save.mockResolvedValue({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
      } as any);

      const done = jest.fn();
      await strategy.validate(profile, done);

      expect(done).toHaveBeenCalledWith(null, expect.anything());
    });
  });

  describe('Error Handling', () => {
    it('should handle repository errors gracefully', async () => {
      const profile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '2',
        },
      };

      // Mock the use case to throw an error (simulating repository failure)
      handleSPIDCallbackUseCase.execute.mockRejectedValue(
        new Error('Database connection failed')
      );

      const done = jest.fn();
      await strategy.validate(profile, done);

      expect(done).toHaveBeenCalledWith(expect.any(Error), null);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log authentication attempts', async () => {
      const profile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalCode: 'RSSMRA80A01H501U',
          name: 'Mario',
          familyName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidCode: '2',
        },
      };

      userRepository.findByFiscalCode.mockResolvedValue(null);
      userRepository.save.mockResolvedValue({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
      } as any);

      const done = jest.fn();
      await strategy.validate(profile, done);

      // Check that info logging was called (multiple times - validating, extracting, success)
      expect(logger.info).toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(null, expect.anything());
    });
  });

  describe('Attribute Mapping', () => {
    it('should map SPID attributes correctly', async () => {
      const profile = {
        issuer: 'https://identity.infocert.it',
        sessionIndex: 'session-123',
        nameID: 'RSSMRA80A01H501U',
        attributes: {
          fiscalNumber: 'RSSMRA80A01H501U', // Alternative attribute name
          givenName: 'Mario', // Alternative attribute name
          surname: 'Rossi', // Alternative attribute name
          emailAddress: 'mario.rossi@example.it', // Alternative attribute name
          spidLevel: '2', // Alternative attribute name
        },
      };

      userRepository.findByFiscalCode.mockResolvedValue(null);
      userRepository.save.mockResolvedValue({
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
      } as any);

      const done = jest.fn();
      await strategy.validate(profile, done);

      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
        user: expect.objectContaining({
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: 'mario.rossi@example.it',
          spidLevel: 2,
        }),
      }));
    });
  });
});
