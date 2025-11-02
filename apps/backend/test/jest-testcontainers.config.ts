import { Config } from '@jest/types';

/**
 * Jest configuration with Testcontainers
 *
 * Uses Testcontainers to spin up real PostgreSQL and Redis instances
 * for integration and E2E tests. This ensures tests run against real
 * database behavior rather than mocks.
 *
 * Testcontainers:
 * - PostgreSQL 16 (same as production)
 * - Redis 7 (for cache and queue tests)
 *
 * Environment:
 * - Test database isolated per test suite
 * - Automatic cleanup after tests
 * - Parallel test execution disabled for E2E tests
 */
const config: Config.InitialOptions = {
  displayName: 'e2e-tests',
  testEnvironment: 'node',
  rootDir: '../',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\.(t|j)s$': 'ts-jest',
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
  ],
  coverageDirectory: './coverage',
  testTimeout: 60000, // 60s for testcontainer startup
  maxWorkers: 1, // Run E2E tests sequentially
  globalSetup: './test/global-setup.ts',
  globalTeardown: './test/global-teardown.ts',
};

export default config;
