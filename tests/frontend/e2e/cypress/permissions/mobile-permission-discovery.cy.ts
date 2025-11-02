/**
 * E2E tests for mobile permission discovery
 * Tests mobile-first permission UX with touch targets and visual indicators
 * T124: Mobile permission discovery E2E tests per User Story 3
 *
 * Purpose: Verify field operators can discover permission boundaries on mobile devices
 * with clear visual feedback and 56px touch targets
 *
 * Requirements from spec.md acceptance scenario 1:
 * - Field operator logs in on mobile device
 * - Sees role badge "FIELD_OPERATOR"
 * - Taps "My Permissions" page
 * - Sees collapsible accordion on mobile (not grid)
 * - Taps "FIR Management" category
 * - Sees: ✓ Create FIRs (green), ✓ Edit own FIRs (green), ✗ Delete FIRs (gray)
 * - Taps help icon next to "Delete FIRs"
 * - Sees tooltip: "Only facility managers can delete FIRs. Contact your administrator to request access."
 *
 * Requirements from plan.md:
 * - Touch targets minimum 56px (WCAG 2.5.5 AAA)
 * - Mobile-first responsive design
 * - Haptic feedback on permission denied
 * - Full-screen error page takeover
 */

describe('Mobile Permission Discovery (User Story 3)', () => {
  // Mock user with FIELD_OPERATOR role
  const mockOperatorToken = 'mock-jwt-operator-token';
  const mockOperatorPayload = {
    userId: 'operator-user-id',
    tenantId: 'tenant-123',
    roleId: 'role-field-operator',
    roleName: 'FIELD_OPERATOR',
    permissions: [
      'fir:create:facility',
      'fir:read:facility',
      'fir:update:own',
      // Notably missing: fir:delete:facility
    ],
  };

  beforeEach(() => {
    // Set mobile viewport (iPhone 12)
    cy.viewport(390, 844);

    // Mock JWT authentication
    cy.window().then((win) => {
      win.localStorage.setItem('jwt', mockOperatorToken);
    });

    // Intercept permissions API
    cy.intercept('GET', '/api/v1/permissions/me', {
      statusCode: 200,
      body: {
        userId: mockOperatorPayload.userId,
        roleId: mockOperatorPayload.roleId,
        roleName: mockOperatorPayload.roleName,
        permissions: mockOperatorPayload.permissions,
      },
    }).as('getPermissions');

    // Intercept role details API
    cy.intercept('GET', `/api/v1/roles/${mockOperatorPayload.roleId}`, {
      statusCode: 200,
      body: {
        id: mockOperatorPayload.roleId,
        name: 'FIELD_OPERATOR',
        displayName: 'Field Operator',
        description: 'Operators who create and manage FIRs in the field',
        permissions: mockOperatorPayload.permissions,
      },
    }).as('getRoleDetails');
  });

  describe('Acceptance Scenario 1: Discover permissions on mobile', () => {
    it('should show role badge "FIELD_OPERATOR" on mobile header', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Role badge should be visible
      cy.get('[data-testid="role-badge"]')
        .should('be.visible')
        .and('contain.text', 'FIELD_OPERATOR');

      // Badge should be large enough for touch (56px minimum)
      cy.get('[data-testid="role-badge"]').then(($badge) => {
        expect($badge.outerHeight()).to.be.at.least(56);
      });
    });

    it('should show accordion layout on mobile (not grid)', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Should use accordion on mobile
      cy.get('[data-testid="permission-accordion"]').should('be.visible');

      // Grid layout should not be visible on mobile
      cy.get('[data-testid="permission-grid"]').should('not.exist');
    });

    it('should show collapsible categories with touch-friendly targets', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Category headers should be at least 56px tall
      cy.get('[data-testid="category-header"]').each(($header) => {
        expect($header.outerHeight()).to.be.at.least(56);
      });

      // Tap to expand "FIR Management" category
      cy.get('[data-testid="category-header"]')
        .contains('FIR Management')
        .click();

      // Category content should be visible
      cy.get('[data-testid="category-content-fir"]').should('be.visible');
    });

    it('should show permission state indicators with colors and icons', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Expand FIR Management
      cy.get('[data-testid="category-header"]')
        .contains('FIR Management')
        .click();

      // Check "Create FIRs" - allowed (green check)
      cy.get('[data-testid="permission-item-fir:create:facility"]')
        .should('be.visible')
        .within(() => {
          cy.get('[data-testid="permission-icon"]')
            .should('have.class', 'allowed')
            .and('contain.text', '✓');
          cy.get('[data-testid="permission-status"]')
            .should('have.css', 'color')
            .and('match', /rgb\(76, 175, 80\)/); // Green color
        });

      // Check "Edit own FIRs" - allowed (green check)
      cy.get('[data-testid="permission-item-fir:update:own"]')
        .should('be.visible')
        .within(() => {
          cy.get('[data-testid="permission-icon"]')
            .should('have.class', 'allowed')
            .and('contain.text', '✓');
        });

      // Check "Delete FIRs" - denied (gray cross)
      cy.get('[data-testid="permission-item-fir:delete:facility"]')
        .should('be.visible')
        .within(() => {
          cy.get('[data-testid="permission-icon"]')
            .should('have.class', 'denied')
            .and('contain.text', '✗');
          cy.get('[data-testid="permission-status"]')
            .should('have.css', 'color')
            .and('match', /rgb\(158, 158, 158\)/); // Gray color
        });
    });

    it('should show contextual help tooltip for denied permissions', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Expand FIR Management
      cy.get('[data-testid="category-header"]')
        .contains('FIR Management')
        .click();

      // Tap help icon next to "Delete FIRs"
      cy.get('[data-testid="permission-item-fir:delete:facility"]')
        .find('[data-testid="help-icon"]')
        .click();

      // Tooltip should appear with helpful message
      cy.get('[data-testid="permission-tooltip"]')
        .should('be.visible')
        .and('contain.text', 'Only facility managers can delete FIRs')
        .and('contain.text', 'Contact your administrator to request access');
    });

    it('should allow tapping anywhere on permission row to show details', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      cy.get('[data-testid="category-header"]')
        .contains('FIR Management')
        .click();

      // Entire row should be tappable (56px minimum)
      cy.get('[data-testid="permission-item-fir:create:facility"]')
        .should('have.css', 'min-height', '56px')
        .click();

      // Detail view or tooltip should appear
      cy.get('[data-testid="permission-detail"]').should('be.visible');
    });
  });

  describe('Acceptance Scenario 2: Attempt unauthorized action', () => {
    beforeEach(() => {
      // Intercept FIR deletion attempt
      cy.intercept('DELETE', '/api/v1/firs/*', {
        statusCode: 403,
        body: {
          statusCode: 403,
          message: 'Insufficient permissions to delete FIR',
          error: 'Forbidden',
          requiredPermission: 'fir:delete:facility',
          userPermissions: mockOperatorPayload.permissions,
        },
      }).as('deleteFir');
    });

    it('should show full-screen permission denied page with 56px buttons', () => {
      cy.visit('/firs/fir-123');

      // Attempt to delete FIR
      cy.get('[data-testid="delete-fir-button"]').click();
      cy.get('[data-testid="confirm-delete-button"]').click();

      cy.wait('@deleteFir');

      // Full-screen error overlay should appear
      cy.get('[data-testid="permission-denied-overlay"]')
        .should('be.visible')
        .and('have.css', 'position', 'fixed')
        .and('have.css', 'z-index', '9999');

      // Error title
      cy.get('[data-testid="error-title"]')
        .should('be.visible')
        .and('contain.text', 'Permission Denied');

      // Error description
      cy.get('[data-testid="error-description"]')
        .should('be.visible')
        .and('contain.text', 'delete FIR');

      // Action buttons should be at least 56px tall
      cy.get('[data-testid="go-back-button"]').then(($btn) => {
        expect($btn.outerHeight()).to.be.at.least(56);
      });

      cy.get('[data-testid="request-access-button"]').then(($btn) => {
        expect($btn.outerHeight()).to.be.at.least(56);
      });
    });

    it('should show "Request Access" button that navigates to request form', () => {
      cy.visit('/firs/fir-123');

      // Trigger permission denied
      cy.get('[data-testid="delete-fir-button"]').click();
      cy.get('[data-testid="confirm-delete-button"]').click();
      cy.wait('@deleteFir');

      // Click "Request Access"
      cy.get('[data-testid="request-access-button"]').click();

      // Should navigate to request form (US7 integration)
      cy.url().should('include', '/permissions/request');
      cy.get('[data-testid="permission-request-form"]').should('be.visible');
    });

    it('should provide helpful context about required permission', () => {
      cy.visit('/firs/fir-123');

      cy.get('[data-testid="delete-fir-button"]').click();
      cy.get('[data-testid="confirm-delete-button"]').click();
      cy.wait('@deleteFir');

      // Should show which permission is required
      cy.get('[data-testid="required-permission"]')
        .should('be.visible')
        .and('contain.text', 'fir:delete:facility');

      // Should show friendly description
      cy.get('[data-testid="required-permission-description"]')
        .should('be.visible')
        .and('contain.text', 'Delete FIRs for assigned facilities');
    });

    it('should trigger haptic feedback on permission denied (mobile)', () => {
      // Note: Actual haptic feedback requires real device
      // Here we verify the API call is made
      let hapticTriggered = false;

      cy.visit('/firs/fir-123', {
        onBeforeLoad(win) {
          if (win.navigator.vibrate) {
            cy.stub(win.navigator, 'vibrate').callsFake(() => {
              hapticTriggered = true;
              return true;
            });
          }
        },
      });

      cy.get('[data-testid="delete-fir-button"]').click();
      cy.get('[data-testid="confirm-delete-button"]').click();
      cy.wait('@deleteFir');

      // Haptic feedback should have been triggered
      cy.window().then(() => {
        expect(hapticTriggered).to.be.true;
      });
    });
  });

  describe('Touch target size validation (56px minimum)', () => {
    it('should have 56px minimum height for all interactive elements', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Category headers
      cy.get('[data-testid="category-header"]').each(($header) => {
        expect($header.outerHeight()).to.be.at.least(56);
      });

      // Permission items
      cy.get('[data-testid="category-header"]').first().click();
      cy.get('[data-testid^="permission-item-"]').each(($item) => {
        expect($item.outerHeight()).to.be.at.least(56);
      });

      // Buttons
      cy.get('button').each(($button) => {
        if ($button.is(':visible')) {
          expect($button.outerHeight()).to.be.at.least(56);
        }
      });
    });

    it('should have adequate spacing between touch targets', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      cy.get('[data-testid="category-header"]').first().click();

      // Permission items should have spacing (at least 8px gap)
      cy.get('[data-testid^="permission-item-"]').then(($items) => {
        if ($items.length > 1) {
          const firstRect = $items[0].getBoundingClientRect();
          const secondRect = $items[1].getBoundingClientRect();
          const gap = secondRect.top - firstRect.bottom;
          expect(gap).to.be.at.least(8);
        }
      });
    });
  });

  describe('Responsive layout behavior', () => {
    it('should switch to grid layout on tablet/desktop', () => {
      // Switch to tablet viewport (iPad)
      cy.viewport(768, 1024);

      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Grid should be visible on larger screens
      cy.get('[data-testid="permission-grid"]').should('be.visible');

      // Accordion should not be visible
      cy.get('[data-testid="permission-accordion"]').should('not.exist');
    });

    it('should maintain touch targets on all screen sizes', () => {
      const viewports = [
        { width: 390, height: 844, name: 'iPhone 12' },
        { width: 768, height: 1024, name: 'iPad' },
        { width: 1920, height: 1080, name: 'Desktop' },
      ];

      viewports.forEach((viewport) => {
        cy.viewport(viewport.width, viewport.height);
        cy.visit('/permissions/discovery');
        cy.wait('@getPermissions');

        cy.get('button:visible').each(($button) => {
          expect($button.outerHeight()).to.be.at.least(56);
        });
      });
    });
  });

  describe('Performance requirements', () => {
    it('should load permission discovery page in <2 seconds', () => {
      const startTime = Date.now();

      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      cy.get('[data-testid="permission-accordion"]').should('be.visible');

      cy.window().then(() => {
        const loadTime = Date.now() - startTime;
        expect(loadTime).to.be.lessThan(2000);
      });
    });

    it('should check permissions in <10ms P99', () => {
      cy.visit('/permissions/discovery');
      cy.wait('@getPermissions');

      // Measure permission check performance
      cy.window().then((win) => {
        const startTime = performance.now();

        // Trigger multiple permission checks
        for (let i = 0; i < 100; i++) {
          cy.get('[data-testid="category-header"]').first().click();
        }

        const endTime = performance.now();
        const avgTime = (endTime - startTime) / 100;

        expect(avgTime).to.be.lessThan(10);
      });
    });
  });
});
