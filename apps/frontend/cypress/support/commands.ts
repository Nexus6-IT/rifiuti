/// <reference types="cypress" />

/**
 * Cypress Custom Commands
 *
 * Reusable commands for common testing operations.
 * Focus on authentication and FIR management workflows.
 */

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Login with email and password (bypassing SPID for tests)
       * @param email - User email
       * @param password - User password
       */
      login(email: string, password: string): Chainable<void>;

      /**
       * Login as test user with default credentials
       */
      loginAsTestUser(): Chainable<void>;

      /**
       * Logout current user
       */
      logout(): Chainable<void>;

      /**
       * Setup authentication token directly (for API tests)
       * @param accessToken - JWT access token
       */
      setAuthToken(accessToken: string): Chainable<void>;

      /**
       * Wait for Angular to be ready
       */
      waitForAngular(): Chainable<void>;

      /**
       * Wait for PrimeNG toast to appear
       * @param severity - Toast severity (success, error, warn, info)
       */
      waitForToast(severity: 'success' | 'error' | 'warn' | 'info'): Chainable<void>;

      /**
       * Close all PrimeNG toasts
       */
      closeToasts(): Chainable<void>;
    }
  }
}

/**
 * Login command - Bypasses SPID for testing
 * Uses direct Keycloak authentication
 */
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session([email, password], () => {
    cy.visit('/auth/login');

    // Fill login form
    cy.get('input[type="email"]').type(email);
    cy.get('input[type="password"]').type(password);
    cy.get('button[type="submit"]').click();

    // Wait for redirect to dashboard
    cy.url().should('include', '/dashboard');
    cy.get('[data-cy="user-menu"]').should('be.visible');
  });
});

/**
 * Login as default test user
 */
Cypress.Commands.add('loginAsTestUser', () => {
  cy.login('test@example.com', 'testpassword123');
});

/**
 * Logout command
 */
Cypress.Commands.add('logout', () => {
  cy.get('[data-cy="user-menu"]').click();
  cy.get('[data-cy="logout-button"]').click();
  cy.url().should('include', '/auth/login');
});

/**
 * Set auth token directly (for API tests)
 */
Cypress.Commands.add('setAuthToken', (accessToken: string) => {
  localStorage.setItem('access_token', accessToken);
});

/**
 * Wait for Angular to be ready
 */
Cypress.Commands.add('waitForAngular', () => {
  cy.window().should('have.property', 'getAllAngularTestabilities');
});

/**
 * Wait for PrimeNG toast to appear
 */
Cypress.Commands.add('waitForToast', (severity: 'success' | 'error' | 'warn' | 'info') => {
  cy.get(`.p-toast-message-${severity}`, { timeout: 10000 }).should('be.visible');
});

/**
 * Close all toasts
 */
Cypress.Commands.add('closeToasts', () => {
  cy.get('.p-toast-message').each(($toast) => {
    cy.wrap($toast).find('.p-toast-icon-close').click();
  });
});

// Prevent TypeScript errors
export {};
