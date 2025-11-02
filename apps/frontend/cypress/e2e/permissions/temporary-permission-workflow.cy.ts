/**
 * Cypress E2E Test: Temporary Permission Workflow
 * T221: Test full temporary permission request/approval workflow
 *
 * Purpose: Verify end-to-end temporary permission lifecycle
 *
 * Test coverage:
 * - Driver requests temporary permissions
 * - Admin receives notification and approves request
 * - Permissions become active
 * - Auto-expiration after grant period
 *
 * Acceptance criteria from spec.md:
 * - Request submitted with justification (min 10 chars)
 * - Admin can approve/deny with reason
 * - Active permissions displayed to user
 * - Permissions auto-expire after 7 days max
 */
describe('Temporary Permission Workflow', () => {
  const driverUser = {
    email: 'driver@test.com',
    password: 'TestDriver123!',
    role: 'OPERATOR',
  };

  const adminUser = {
    email: 'admin@test.com',
    password: 'TestAdmin123!',
    role: 'ADMIN',
  };

  beforeEach(() => {
    // Clear any existing grants
    cy.task('db:clean:grants');
  });

  it('should complete full temporary permission workflow', () => {
    // STEP 1: Driver requests temporary permissions
    cy.login(driverUser.email, driverUser.password);
    cy.visit('/permissions/my-grants');

    // Click "Request Temporary Access" button
    cy.contains('Request Temporary Access').click();

    // Fill out permission request form
    cy.get('[data-cy=permission-request-dialog]').within(() => {
      // Select permissions
      cy.get('[data-cy=permission-multiselect]').click();
      cy.contains('FIR: Export (All)').click();
      cy.contains('Report: Export (All)').click();
      cy.get('[data-cy=permission-multiselect]').click(); // Close dropdown

      // Set duration (3 days)
      cy.get('[data-cy=duration-slider]').invoke('val', 3).trigger('change');

      // Enter justification
      cy.get('[data-cy=justification-textarea]').type(
        'Need export access for quarterly audit report preparation',
      );

      // Submit request
      cy.get('[data-cy=submit-request-btn]').click();
    });

    // Verify success message
    cy.contains('Permission request submitted successfully').should('be.visible');

    // Verify request appears in "My Grants" with pending status
    cy.get('[data-cy=grant-list]').within(() => {
      cy.contains('Pending').should('be.visible');
      cy.contains('FIR: Export (All)').should('be.visible');
    });

    cy.logout();

    // STEP 2: Admin approves the request
    cy.login(adminUser.email, adminUser.password);
    cy.visit('/permissions/pending-grants');

    // Verify request appears in pending list
    cy.get('[data-cy=pending-grants-table]').within(() => {
      cy.contains(driverUser.email).should('be.visible');
      cy.contains('FIR: Export (All)').should('be.visible');

      // Click approve button
      cy.get('[data-cy=approve-btn]').first().click();
    });

    // Fill approval reason
    cy.get('[data-cy=approval-dialog]').within(() => {
      cy.get('[data-cy=approval-reason]').type('Approved for quarterly audit');
      cy.get('[data-cy=confirm-approval-btn]').click();
    });

    // Verify success message
    cy.contains('Permission request approved').should('be.visible');

    // Verify request no longer in pending list
    cy.get('[data-cy=pending-grants-table]').within(() => {
      cy.contains(driverUser.email).should('not.exist');
    });

    cy.logout();

    // STEP 3: Driver sees active permissions
    cy.login(driverUser.email, driverUser.password);
    cy.visit('/permissions/my-grants');

    // Verify grant is now active
    cy.get('[data-cy=grant-list]').within(() => {
      cy.contains('Active').should('be.visible');
      cy.contains('FIR: Export (All)').should('be.visible');
      cy.contains('Approved for quarterly audit').should('be.visible');

      // Verify countdown timer is displayed
      cy.get('[data-cy=expiration-countdown]').should('be.visible');
    });

    // Verify permissions are actually active by testing protected action
    cy.visit('/fir');
    cy.get('[data-cy=export-fir-btn]').should('be.enabled'); // Should now be enabled with temp permission

    cy.logout();

    // STEP 4: Simulate expiration (requires backend job or time manipulation)
    // NOTE: In a real test, you would either:
    // 1. Mock the system time to 7 days in the future
    // 2. Manually trigger the expiration job via API
    // 3. Create the grant with a very short expiration (1 minute) for testing
    //
    // For this stub, we'll just verify the expiration job can be triggered:
    cy.task('db:expireGrants'); // Custom Cypress task to manually expire grants

    cy.login(driverUser.email, driverUser.password);
    cy.visit('/permissions/my-grants');

    // Verify grant is now expired
    cy.get('[data-cy=grant-list]').within(() => {
      cy.contains('Expired').should('be.visible');
    });

    // Verify permissions are revoked
    cy.visit('/fir');
    cy.get('[data-cy=export-fir-btn]').should('be.disabled'); // Should be disabled again
  });

  it('should allow admin to revoke active grant', () => {
    // Setup: Create an active grant
    cy.task('db:createActiveGrant', {
      userId: driverUser.email,
      permissions: ['fir:export:all'],
    });

    cy.login(adminUser.email, adminUser.password);
    cy.visit('/permissions/my-grants'); // Admin view of all grants

    // Find and revoke the grant
    cy.get('[data-cy=active-grants-table]').within(() => {
      cy.contains(driverUser.email).should('be.visible');
      cy.get('[data-cy=revoke-btn]').first().click();
    });

    // Fill revocation reason
    cy.get('[data-cy=revocation-dialog]').within(() => {
      cy.get('[data-cy=revocation-reason]').type('Security concern - access no longer needed');
      cy.get('[data-cy=confirm-revocation-btn]').click();
    });

    // Verify success message
    cy.contains('Permission grant revoked').should('be.visible');

    // Verify grant is revoked
    cy.login(driverUser.email, driverUser.password);
    cy.visit('/permissions/my-grants');

    cy.get('[data-cy=grant-list]').within(() => {
      cy.contains('Revoked').should('be.visible');
    });
  });

  it('should enforce max 10 permissions per request', () => {
    cy.login(driverUser.email, driverUser.password);
    cy.visit('/permissions/my-grants');

    cy.contains('Request Temporary Access').click();

    cy.get('[data-cy=permission-request-dialog]').within(() => {
      // Try to select 11 permissions
      cy.get('[data-cy=permission-multiselect]').click();

      // Select 11 permissions (should show error at 11th)
      for (let i = 0; i < 11; i++) {
        cy.get(`[data-cy=permission-option-${i}]`).click();
      }

      // Verify error message
      cy.contains('Maximum 10 permissions allowed').should('be.visible');

      // Submit button should be disabled
      cy.get('[data-cy=submit-request-btn]').should('be.disabled');
    });
  });

  it('should enforce min 10 character justification', () => {
    cy.login(driverUser.email, driverUser.password);
    cy.visit('/permissions/my-grants');

    cy.contains('Request Temporary Access').click();

    cy.get('[data-cy=permission-request-dialog]').within(() => {
      cy.get('[data-cy=permission-multiselect]').click();
      cy.contains('FIR: Export (All)').click();
      cy.get('[data-cy=permission-multiselect]').click();

      cy.get('[data-cy=duration-slider]').invoke('val', 1).trigger('change');

      // Enter short justification (< 10 chars)
      cy.get('[data-cy=justification-textarea]').type('Too short');

      // Verify validation error
      cy.contains('Justification must be at least 10 characters').should('be.visible');

      // Submit button should be disabled
      cy.get('[data-cy=submit-request-btn]').should('be.disabled');
    });
  });
});
