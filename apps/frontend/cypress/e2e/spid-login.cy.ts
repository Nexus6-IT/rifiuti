/**
 * SPID Login Cypress E2E Tests
 *
 * End-to-end tests for frontend SPID authentication flow:
 * 1. User visits login page
 * 2. Clicks "Login with SPID" button
 * 3. Redirected to SPID provider selection
 * 4. Selects provider and authenticates
 * 5. Redirected back to application
 * 6. Session established and user can access protected pages
 *
 * Note: These tests mock SPID provider interactions since we can't
 * actually authenticate with real SPID providers in automated tests.
 */

describe('SPID Login Flow', () => {
  beforeEach(() => {
    // Clear cookies and local storage before each test
    cy.clearCookies();
    cy.clearLocalStorage();

    // Mock API endpoints
    cy.intercept('GET', '/api/auth/session', { statusCode: 401 }).as('sessionCheck');
  });

  describe('Login Page', () => {
    it('should display SPID login button', () => {
      cy.visit('/login');

      cy.contains('Login with SPID').should('be.visible');
      cy.contains('Login with CIE').should('be.visible');
    });

    it('should show SPID provider logos', () => {
      cy.visit('/login');

      cy.get('[data-cy=spid-button]').should('be.visible');
      cy.get('[data-cy=spid-button]').should('contain', 'SPID');
      cy.get('img[alt*="SPID"]').should('be.visible');
    });

    it('should redirect to provider selection on SPID button click', () => {
      cy.visit('/login');

      // Mock redirect to Keycloak
      cy.intercept('GET', '/api/auth/login*', {
        statusCode: 302,
        headers: {
          location: 'http://localhost:8080/auth/realms/wasteflow/protocol/saml',
        },
      }).as('spidLogin');

      cy.get('[data-cy=spid-button]').click();

      cy.wait('@spidLogin');
    });
  });

  describe('SPID Authentication', () => {
    it('should complete SPID login flow successfully', () => {
      cy.visit('/login');

      // Mock SPID callback
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        tenantId: 'tenant-123',
      };

      const mockTokenResponse = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: mockUser,
      };

      // Intercept callback
      cy.intercept('POST', '/api/auth/callback', {
        statusCode: 200,
        body: mockTokenResponse,
      }).as('authCallback');

      // Intercept session check after login
      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: mockUser,
          spidLevel: 2,
          canSignDocuments: true,
          authenticatedAt: new Date().toISOString(),
          sessionExpiry: new Date(Date.now() + 3600000).toISOString(),
        },
      }).as('sessionAfterLogin');

      // Simulate SPID callback
      cy.visit('/auth/callback?SAMLResponse=mock-saml-response');

      cy.wait('@authCallback');

      // Should redirect to dashboard
      cy.url().should('include', '/dashboard');

      // Should show user info in header
      cy.get('[data-cy=user-menu]').should('contain', 'Mario Rossi');
      cy.get('[data-cy=user-fiscal-code]').should('contain', 'RSSMRA80A01H501U');
    });

    it('should show SPID level indicator for Level 2+', () => {
      // Mock authenticated session
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        tenantId: 'tenant-123',
      };

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: mockUser,
          spidLevel: 2,
          canSignDocuments: true,
          authenticatedAt: new Date().toISOString(),
        },
      }).as('session');

      // Set mock token in localStorage
      window.localStorage.setItem('accessToken', 'mock-access-token');

      cy.visit('/dashboard');
      cy.wait('@session');

      // Should show SPID level badge
      cy.get('[data-cy=spid-level-badge]').should('contain', 'Level 2');
      cy.get('[data-cy=can-sign-indicator]').should('be.visible');
    });

    it('should handle authentication error', () => {
      cy.visit('/login');

      cy.intercept('POST', '/api/auth/callback', {
        statusCode: 401,
        body: {
          message: 'Invalid SAML response',
        },
      }).as('authCallbackError');

      cy.visit('/auth/callback?SAMLResponse=invalid-response');

      cy.wait('@authCallbackError');

      // Should show error message
      cy.get('[data-cy=error-message]').should('contain', 'Authentication failed');

      // Should redirect to login page
      cy.url().should('include', '/login');
    });
  });

  describe('CIE Authentication', () => {
    it('should support CIE login', () => {
      cy.visit('/login');

      cy.intercept('GET', '/api/auth/login*', (req) => {
        expect(req.query.provider).to.equal('cie');
        req.reply({
          statusCode: 302,
          headers: {
            location: 'http://localhost:8080/auth/realms/wasteflow/protocol/saml/clients/cie',
          },
        });
      }).as('cieLogin');

      cy.get('[data-cy=cie-button]').click();

      cy.wait('@cieLogin');
    });

    it('should show CIE as Level 3 authentication', () => {
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 3, // CIE is always Level 3
        tenantId: 'tenant-123',
      };

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: mockUser,
          spidLevel: 3,
          canSignDocuments: true,
          authMethod: 'CIE',
        },
      });

      window.localStorage.setItem('accessToken', 'mock-access-token');

      cy.visit('/dashboard');

      cy.get('[data-cy=spid-level-badge]').should('contain', 'Level 3');
      cy.get('[data-cy=auth-method]').should('contain', 'CIE');
    });
  });

  describe('Session Management', () => {
    beforeEach(() => {
      // Setup authenticated session
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: 'mario.rossi@example.it',
        spidLevel: 2,
        tenantId: 'tenant-123',
      };

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: mockUser,
          spidLevel: 2,
          canSignDocuments: true,
          authenticatedAt: new Date().toISOString(),
        },
      }).as('session');

      window.localStorage.setItem('accessToken', 'mock-access-token');
    });

    it('should show session info in user menu', () => {
      cy.visit('/dashboard');
      cy.wait('@session');

      cy.get('[data-cy=user-menu]').click();

      cy.get('[data-cy=user-info-panel]').should('be.visible');
      cy.get('[data-cy=user-fiscal-code]').should('contain', 'RSSMRA80A01H501U');
      cy.get('[data-cy=user-email]').should('contain', 'mario.rossi@example.it');
      cy.get('[data-cy=spid-level]').should('contain', '2');
    });

    it('should handle logout', () => {
      cy.intercept('POST', '/api/auth/logout', {
        statusCode: 200,
      }).as('logout');

      cy.visit('/dashboard');

      cy.get('[data-cy=user-menu]').click();
      cy.get('[data-cy=logout-button]').click();

      cy.wait('@logout');

      // Should clear tokens
      cy.window().then((win) => {
        expect(win.localStorage.getItem('accessToken')).to.be.null;
        expect(win.localStorage.getItem('refreshToken')).to.be.null;
      });

      // Should redirect to login
      cy.url().should('include', '/login');
    });

    it('should refresh token automatically on expiry', () => {
      // Mock token refresh
      cy.intercept('POST', '/api/auth/refresh', {
        statusCode: 200,
        body: {
          accessToken: 'new-mock-access-token',
          refreshToken: 'new-mock-refresh-token',
        },
      }).as('refresh');

      cy.visit('/dashboard');

      // Simulate token expiry - trigger refresh
      cy.window().then((win) => {
        win.postMessage({ type: 'TOKEN_EXPIRED' }, '*');
      });

      cy.wait('@refresh');

      // Should update token in storage
      cy.window().then((win) => {
        expect(win.localStorage.getItem('accessToken')).to.equal('new-mock-access-token');
      });
    });
  });

  describe('Protected Routes', () => {
    it('should redirect to login for unauthenticated user', () => {
      cy.intercept('GET', '/api/auth/session', {
        statusCode: 401,
      });

      cy.visit('/fir');

      // Should redirect to login
      cy.url().should('include', '/login');

      // Should show message
      cy.get('[data-cy=auth-required-message]').should('contain', 'Please login to continue');
    });

    it('should preserve return URL after login', () => {
      const returnUrl = '/fir/create';

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 401,
      });

      // Try to access protected page
      cy.visit(returnUrl);

      // Should redirect to login with returnUrl
      cy.url().should('include', '/login');
      cy.url().should('include', `returnUrl=${encodeURIComponent(returnUrl)}`);

      // Mock successful login
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        tenantId: 'tenant-123',
      };

      cy.intercept('POST', '/api/auth/callback', {
        statusCode: 200,
        body: {
          accessToken: 'mock-access-token',
          user: mockUser,
        },
      });

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: { user: mockUser, canSignDocuments: true },
      });

      // Simulate callback
      cy.visit('/auth/callback?SAMLResponse=mock&returnUrl=' + encodeURIComponent(returnUrl));

      // Should redirect to original page
      cy.url().should('include', returnUrl);
    });

    it('should show insufficient SPID level warning for signature actions', () => {
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        spidLevel: 1, // Insufficient for signing
        tenantId: 'tenant-123',
      };

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: mockUser,
          spidLevel: 1,
          canSignDocuments: false,
          insufficientLevel: true,
        },
      });

      window.localStorage.setItem('accessToken', 'mock-access-token');

      cy.visit('/fir/123');

      // Signature button should be disabled with tooltip
      cy.get('[data-cy=sign-fir-button]').should('be.disabled');
      cy.get('[data-cy=sign-fir-button]').trigger('mouseenter');
      cy.get('[data-cy=tooltip]').should('contain', 'SPID Level 2 or higher required');
    });
  });

  describe('Multi-Tenant Selection', () => {
    it('should show tenant selector for users with multiple tenants', () => {
      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        tenants: [
          { id: 'tenant-1', name: 'Azienda A' },
          { id: 'tenant-2', name: 'Azienda B' },
        ],
      };

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: {
          user: mockUser,
          canSignDocuments: true,
        },
      });

      window.localStorage.setItem('accessToken', 'mock-access-token');

      cy.visit('/dashboard');

      cy.get('[data-cy=tenant-selector]').should('be.visible');
      cy.get('[data-cy=tenant-selector]').click();
      cy.get('[data-cy=tenant-option]').should('have.length', 2);
      cy.get('[data-cy=tenant-option]').first().should('contain', 'Azienda A');
    });

    it('should switch tenant context', () => {
      cy.intercept('POST', '/api/auth/switch-tenant', {
        statusCode: 200,
        body: {
          accessToken: 'new-token-for-tenant-2',
        },
      }).as('switchTenant');

      cy.intercept('GET', '/api/fir', {
        statusCode: 200,
        body: {
          data: [], // Different data for different tenant
        },
      }).as('firList');

      const mockUser = {
        id: 'user-123',
        fiscalCode: 'RSSMRA80A01H501U',
        tenants: [
          { id: 'tenant-1', name: 'Azienda A' },
          { id: 'tenant-2', name: 'Azienda B' },
        ],
      };

      cy.intercept('GET', '/api/auth/session', {
        statusCode: 200,
        body: { user: mockUser, canSignDocuments: true },
      });

      window.localStorage.setItem('accessToken', 'mock-access-token');

      cy.visit('/dashboard');

      cy.get('[data-cy=tenant-selector]').click();
      cy.get('[data-cy=tenant-option]').eq(1).click(); // Select "Azienda B"

      cy.wait('@switchTenant');

      // Should update token and reload data
      cy.window().then((win) => {
        expect(win.localStorage.getItem('accessToken')).to.equal('new-token-for-tenant-2');
      });
    });
  });
});
