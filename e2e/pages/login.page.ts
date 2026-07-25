import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /login (WasteFlow).
 *
 * NOTA SELETTORI: il componente attuale (features/auth/login.component.ts)
 * espone un solo bottone "Accedi" senza data-testid/data-cy (vedi
 * docs/audits/uat-2026-07-25/02-frontend-flows.md §4 e
 * e2e/SELECTORS-DEBT.md). Ci appoggiamo al ruolo ARIA + testo visibile.
 */
export class LoginPage {
  readonly page: Page
  readonly accediButton: Locator

  constructor(page: Page) {
    this.page = page
    // Testo osservato nell'audit: "Accedi" (bottone unico, avvia SPID/Keycloak)
    this.accediButton = page.getByRole('button', { name: /accedi/i })
  }

  async goto() {
    await this.page.goto('/login')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/login/)
    await expect(this.accediButton).toBeVisible()
  }

  /**
   * Avvia il login: click su "Accedi" innesca un full-page redirect
   * (window.location.href, non router.navigate) verso
   * `${apiUrl}/auth/spid/login?provider=spid` e poi verso l'IdP Keycloak/SAML.
   * Il chiamante deve attendere la navigazione risultante.
   */
  async clickAccedi() {
    await Promise.all([this.page.waitForURL(/.*/), this.accediButton.click()])
  }
}
