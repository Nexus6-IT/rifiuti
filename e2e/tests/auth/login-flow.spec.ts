import { test, expect } from '@playwright/test'
import { LoginPage } from '../../pages/login.page'
import { DashboardPage } from '../../pages/dashboard.page'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getRoleCredentials } from '../../utils/env'

/**
 * Ciclo di login SPID/Keycloak completo (UAT critico #1 dell'audit
 * frontend). Skip condizionale se mancano le credenziali E2E_ADMIN_USER/PASS
 * — non deve MAI fallire rumorosamente in loro assenza.
 *
 * TODO(credenziali): rimuovere/rivedere lo skip quando E2E_ADMIN_USER/PASS
 * saranno disponibili. Vedi e2e/fixtures/auth.ts per i dettagli del TODO sul
 * flusso Keycloak.
 */
test.describe('Login SPID/Keycloak', () => {
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test('login completo porta alla dashboard con sessione valida', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'admin')
    const dashboard = new DashboardPage(page)
    await dashboard.expectLoaded()
  })

  test('logout invalida la sessione e torna a /login', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'admin')
    const dashboard = new DashboardPage(page)
    await dashboard.expectLoaded()
    await dashboard.logoutButton.click()
    await page.waitForURL(/\/login/)
  })

  // Bug sospetto dall'audit §5.9: il flusso SPID reale naviga SEMPRE a
  // /dashboard dopo il login, ignorando `returnUrl` per i deep-link. Questo
  // test verifica esplicitamente il comportamento (fixme finché non
  // confermato/corretto, per non far fallire silenziosamente la suite su un
  // bug già noto e non ancora deciso se è un difetto o comportamento voluto).
  test.fixme(
    'deep-link su rotta protetta prima del login: dopo il login SPID si torna alla rotta originale (returnUrl)',
    async ({ page, context }) => {
      const creds = getRoleCredentials('admin')
      test.skip(!creds, skipReason('admin'))

      await page.goto('/fir')
      await page.waitForURL(/\/login/)

      const loginPage = new LoginPage(page)
      await loginPage.clickAccedi()
      // ... completare login Keycloak (vedi loginAndSaveState) ...

      // Comportamento atteso se il bug fosse risolto: redirect a /fir.
      await page.waitForURL(/\/fir/, { timeout: 30_000 })
    },
  )
})
