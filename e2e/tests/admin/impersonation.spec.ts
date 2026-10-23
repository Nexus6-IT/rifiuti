import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { AdminUsersPage } from '../../pages/admin-users.page'
import { DashboardPage } from '../../pages/dashboard.page'

/**
 * UAT critico #4 dell'audit frontend: impersonificazione SUPER_ADMIN -> utente.
 * Avvio da /admin/utenti -> banner globale visibile su ogni pagina ->
 * operazioni come utente impersonato -> "Torna al tuo account" ripristina il
 * token originale senza re-login.
 */

test.describe('Impersonificazione utente (SUPER_ADMIN)', () => {
  test.skip(!hasRoleCredentials('superAdmin'), skipReason('superAdmin'))

  test.fixme(
    'avvio impersonificazione mostra il banner globale persistente',
    async ({ page, context }) => {
      await loginAndSaveState(page, context, 'superAdmin')
      const adminUsers = new AdminUsersPage(page)
      await adminUsers.goto()
      await adminUsers.expectLoaded()

      // TODO: individuare una riga utente di test dedicata (non un utente reale)
      const row = adminUsers.rowByEmail('TODO-utente-test@example.com')
      await adminUsers.impersonaButtonInRow(row).click()

      const dashboard = new DashboardPage(page)
      await expect(dashboard.impersonationBanner).toBeVisible()

      // Il banner deve restare visibile navigando su un'altra pagina.
      await page.goto('/fir')
      await expect(dashboard.impersonationBanner).toBeVisible()
    }
  )

  test.fixme(
    '"Torna al tuo account" ripristina il token originale senza richiedere nuovo login',
    async ({ page, context }) => {
      await loginAndSaveState(page, context, 'superAdmin')
      // TODO: ripetere avvio impersonificazione, poi cliccare "Torna al tuo account"
      // e verificare che l'utente torni ad essere il SUPER_ADMIN originale
      // (es. leggendo di nuovo /admin/utenti, riservato al ruolo originale).
    }
  )
})
