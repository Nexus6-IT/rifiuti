import { ConfigService } from '@nestjs/config';

export type MockConfigService = jest.Mocked<ConfigService>;

/**
 * Creates a mock ConfigService with common environment variables
 *
 * This utility provides pre-configured mocks for all environment variables
 * used in the authentication system, ensuring consistent test behavior.
 *
 * @example
 * ```typescript
 * import { createConfigServiceMock } from '../../../test/utils/config-service-mock.factory';
 *
 * let configService: MockConfigService;
 *
 * beforeEach(() => {
 *   configService = createConfigServiceMock();
 *
 *   // Override specific values if needed
 *   configService.get.mockImplementation((key: string) => {
 *     if (key === 'JWT_SECRET') return 'custom-secret';
 *     return configService.get(key);
 *   });
 * });
 * ```
 */
export function createConfigServiceMock(): MockConfigService {
  const config: Record<string, any> = {
    'JWT_SECRET': 'test-jwt-secret-key-for-testing-only',
    'JWT_EXPIRES_IN': '900', // 15 minutes
    'JWT_REFRESH_EXPIRES_IN': '604800', // 7 days
    'SPID_CALLBACK_URL': 'http://localhost:3000/api/v1/auth/spid/callback',
    'SPID_ENTITY_ID': 'https://test-wasteflow.example.com',
    'SPID_ISSUER': 'https://test-wasteflow.example.com',
    'SPID_IDP_ENTRY_POINT': 'https://spid-testenv.example.com/sso',
    'SPID_ENTRY_POINT': 'https://spid-testenv.example.com/sso',
    'SPID_IDP_ISSUER': 'https://spid-testenv.example.com',
    'SPID_IDP_CERT': '-----BEGIN CERTIFICATE-----\nMIIDMock=\n-----END CERTIFICATE-----',
    'SPID_PUBLIC_CERT': '-----BEGIN CERTIFICATE-----\nMIIDMock=\n-----END CERTIFICATE-----',
    'SPID_CERT': '-----BEGIN CERTIFICATE-----\nMIIDMock=\n-----END CERTIFICATE-----',
    'SPID_PRIVATE_KEY': '-----BEGIN PRIVATE KEY-----\nMockPrivateKey\n-----END PRIVATE KEY-----',
    'DATABASE_URL': 'postgresql://test:test@localhost:5432/test_db',
    'REDIS_HOST': 'localhost',
    'REDIS_PORT': '6379',
    'NODE_ENV': 'test',
  };

  const mock = {
    get: jest.fn((key: string, defaultValue?: any) => {
      return config[key] ?? defaultValue;
    }),
    getOrThrow: jest.fn((key: string) => {
      const value = config[key];
      if (value === undefined) {
        throw new Error(`Configuration key "${key}" does not exist`);
      }
      return value;
    }),
  } as unknown as MockConfigService;

  return mock;
}
