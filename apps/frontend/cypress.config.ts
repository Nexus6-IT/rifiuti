import { defineConfig } from 'cypress';

/**
 * Cypress E2E Testing Configuration
 *
 * Configured for Angular application with PrimeNG components.
 * Tests cover full user workflows including SPID/CIE authentication,
 * FIR creation/management, and RENTRI synchronization.
 *
 * Features:
 * - Video recording on failure only
 * - Screenshots on failure
 * - Custom commands for auth and common operations
 * - Component testing disabled (using Jasmine/Karma instead)
 */
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    downloadsFolder: 'cypress/downloads',

    // Browser configuration
    viewportWidth: 1280,
    viewportHeight: 720,

    // Timeouts
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    responseTimeout: 30000,
    pageLoadTimeout: 30000,

    // Video and screenshot settings
    video: false, // Enable only on CI
    videoCompression: 32,
    screenshotOnRunFailure: true,

    // Retry configuration
    retries: {
      runMode: 2, // Retry twice in CI
      openMode: 0, // No retries in dev
    },

    // Environment variables
    env: {
      apiUrl: 'http://localhost:3000/v1',
      keycloakUrl: 'http://localhost:8080',
    },

    setupNodeEvents(on, config) {
      // Add custom tasks here if needed
      return config;
    },
  },

  component: {
    devServer: {
      framework: 'angular',
      bundler: 'webpack',
    },
    specPattern: '**/*.cy.ts',
  },
});
