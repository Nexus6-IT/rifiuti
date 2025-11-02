/**
 * E2E Integration Test: Offline Permission Flow
 *
 * Tests spec.md FR-040-042:
 * 1. Verify permissions work offline for 24 hours
 * 2. Verify high-risk operations blocked offline
 * 3. Verify sync on reconnect
 */

describe('Offline Permission Flow (FR-040-042)', () => {
  const testUser = {
    id: 'user-123',
    email: 'test@example.com',
    permissions: ['fir:read:all', 'fir:create:facility'],
    roles: ['OPERATOR'],
  };

  beforeEach(() => {
    // Clear IndexedDB before each test
    indexedDB.deleteDatabase('WasteFlowOfflineCache');
    indexedDB.deleteDatabase('WasteFlowSyncQueue');

    // Login to cache permissions
    cy.login(testUser);
    cy.visit('/dashboard');
  });

  describe('24-hour offline cache (FR-040)', () => {
    it('should cache permissions locally on login', () => {
      // Verify IndexedDB contains cached permissions
      cy.window().then((win) => {
        const request = win.indexedDB.open('WasteFlowOfflineCache');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('permissions', 'readonly');
          const store = tx.objectStore('permissions');
          const get = store.get(testUser.id);

          get.onsuccess = () => {
            const cached = get.result;
            expect(cached).to.exist;
            expect(cached.permissions).to.deep.equal(testUser.permissions);
            expect(cached.lastSynced).to.be.a('number');
          };
        };
      });
    });

    it('should work offline with cached permissions (<24 hours)', () => {
      // Simulate offline mode
      cy.goOffline();

      // Navigate to FIR list (requires fir:read:all permission)
      cy.visit('/fir/list');

      // Should still render page using cached permissions
      cy.contains('Lista FIR').should('be.visible');
      cy.get('[data-cy=fir-table]').should('exist');
    });

    it('should show "Last synced" indicator when offline', () => {
      cy.goOffline();

      // Offline indicator should appear
      cy.get('[data-cy=offline-indicator]').should('be.visible');
      cy.get('[data-cy=offline-indicator]').should('contain', 'Modalità offline');
      cy.get('[data-cy=offline-indicator]').should('contain', 'sincronizzato');
    });

    it('should warn if cached permissions expired (>24 hours)', () => {
      // Manipulate IndexedDB to set old timestamp
      cy.window().then((win) => {
        const request = win.indexedDB.open('WasteFlowOfflineCache');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('permissions', 'readwrite');
          const store = tx.objectStore('permissions');

          const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
          store.put({
            userId: testUser.id,
            tenantId: 'tenant-1',
            permissions: testUser.permissions,
            roles: testUser.roles,
            lastSynced: oldTimestamp,
            expiresAt: oldTimestamp + (24 * 60 * 60 * 1000),
          });
        };
      });

      cy.goOffline();
      cy.visit('/dashboard');

      // Should show expiration warning
      cy.get('[data-cy=permission-expired-warning]').should('be.visible');
      cy.contains('Le tue autorizzazioni sono scadute').should('be.visible');
    });
  });

  describe('High-risk operations blocked offline (FR-041)', () => {
    it('should block FIR deletion when offline', () => {
      cy.visit('/fir/123');
      cy.goOffline();

      // Try to delete FIR
      cy.get('[data-cy=delete-fir-button]').click();

      // Should show "Requires internet" message
      cy.get('[data-cy=offline-blocked-message]').should('be.visible');
      cy.contains('Connessione richiesta').should('be.visible');
      cy.contains('richiede una connessione internet attiva').should('be.visible');

      // Confirmation dialog should NOT appear
      cy.get('[data-cy=delete-confirmation-dialog]').should('not.exist');
    });

    it('should block user approval when offline', () => {
      cy.visit('/admin/users/pending');
      cy.goOffline();

      cy.get('[data-cy=approve-user-button]').first().click();

      cy.get('[data-cy=offline-blocked-message]').should('be.visible');
      cy.contains('Approvazione utente richiede una connessione').should('be.visible');
    });

    it('should block digital signature when offline', () => {
      cy.visit('/fir/123');
      cy.goOffline();

      cy.get('[data-cy=sign-fir-button]').click();

      cy.get('[data-cy=offline-blocked-message]').should('be.visible');
      cy.contains('Firma digitale richiede una connessione').should('be.visible');
    });

    it('should allow read operations when offline', () => {
      cy.goOffline();

      // Should allow viewing FIR list
      cy.visit('/fir/list');
      cy.get('[data-cy=fir-table]').should('exist');

      // Should allow viewing FIR details
      cy.visit('/fir/123');
      cy.get('[data-cy=fir-details]').should('exist');

      // Should allow viewing analytics (read-only)
      cy.visit('/analytics');
      cy.get('[data-cy=analytics-dashboard]').should('exist');
    });
  });

  describe('Sync on reconnect (FR-042)', () => {
    it('should queue operations made offline', () => {
      cy.goOffline();

      // Try to create custom role while offline
      cy.visit('/admin/roles/create');
      cy.get('[data-cy=role-name-input]').type('Custom Role');
      cy.get('[data-cy=save-role-button]').click();

      // Should show "Queued for sync" message
      cy.contains('Sarà sincronizzato quando torni online').should('be.visible');

      // Verify operation added to sync queue
      cy.window().then((win) => {
        const request = win.indexedDB.open('WasteFlowSyncQueue');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('queue', 'readonly');
          const store = tx.objectStore('queue');
          const getAll = store.getAll();

          getAll.onsuccess = () => {
            const queued = getAll.result;
            expect(queued).to.have.length(1);
            expect(queued[0].type).to.equal('CREATE_CUSTOM_ROLE');
            expect(queued[0].status).to.equal('PENDING');
          };
        };
      });
    });

    it('should automatically sync when connection restored', () => {
      // Queue operation while offline
      cy.goOffline();
      cy.visit('/admin/roles/create');
      cy.get('[data-cy=role-name-input]').type('Test Role');
      cy.get('[data-cy=save-role-button]').click();

      // Go back online
      cy.goOnline();

      // Should show sync indicator
      cy.get('[data-cy=sync-indicator]').should('be.visible');
      cy.contains('Sincronizzazione in corso').should('be.visible');

      // Wait for sync to complete
      cy.get('[data-cy=sync-indicator]', { timeout: 10000 }).should('not.exist');

      // Verify operation synced successfully
      cy.contains('Sincronizzazione completata').should('be.visible');

      // Verify IndexedDB queue is empty
      cy.window().then((win) => {
        const request = win.indexedDB.open('WasteFlowSyncQueue');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('queue', 'readonly');
          const store = tx.objectStore('queue');
          const index = store.index('status');
          const getPending = index.getAll('PENDING');

          getPending.onsuccess = () => {
            expect(getPending.result).to.have.length(0);
          };
        };
      });
    });

    it('should retry failed sync operations', () => {
      cy.goOffline();
      cy.visit('/admin/users/invite');
      cy.get('[data-cy=email-input]').type('new@example.com');
      cy.get('[data-cy=send-invite-button]').click();

      // Go online but intercept API to return error
      cy.intercept('POST', '/api/v1/users/invite', {
        statusCode: 500,
        body: { error: 'Server error' },
      }).as('inviteFail');

      cy.goOnline();
      cy.wait('@inviteFail');

      // Should show retry option
      cy.get('[data-cy=sync-failed-message]').should('be.visible');
      cy.get('[data-cy=retry-sync-button]').should('be.visible');

      // Mock successful response
      cy.intercept('POST', '/api/v1/users/invite', {
        statusCode: 200,
        body: { success: true },
      }).as('inviteSuccess');

      // Click retry
      cy.get('[data-cy=retry-sync-button]').click();
      cy.wait('@inviteSuccess');

      // Should succeed
      cy.contains('Sincronizzazione completata').should('be.visible');
    });
  });
});

/**
 * Cypress custom commands for offline testing
 */
declare global {
  namespace Cypress {
    interface Chainable {
      goOffline(): void;
      goOnline(): void;
      login(user: any): void;
    }
  }
}

Cypress.Commands.add('goOffline', () => {
  cy.log('Going offline...');
  cy.window().then((win) => {
    // Simulate offline by stubbing fetch/XMLHttpRequest
    cy.stub(win, 'fetch').rejects(new Error('Network request failed'));
    // Trigger offline event
    win.dispatchEvent(new Event('offline'));
  });
});

Cypress.Commands.add('goOnline', () => {
  cy.log('Going online...');
  cy.window().then((win) => {
    // Restore fetch
    cy.stub(win, 'fetch').restore();
    // Trigger online event
    win.dispatchEvent(new Event('online'));
  });
});

Cypress.Commands.add('login', (user) => {
  cy.window().then((win) => {
    win.localStorage.setItem('authToken', 'mock-jwt-token');
    win.localStorage.setItem('currentUser', JSON.stringify(user));
  });
});
