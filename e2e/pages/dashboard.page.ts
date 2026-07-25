import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /dashboard e per la LayoutComponent condivisa (menu, topbar,
 * tenant switcher, banner impersonificazione). Nessun data-testid disponibile
 * sul layout attivo (shared/components/layout.component.ts) — selettori
 * basati su ARIA (nav principale con aria-label "Navigazione principale",
 * cfr. audit §4).
 */
export class DashboardPage {
  readonly page: Page
  readonly mainNav: Locator
  readonly logoutButton: Locator
  readonly impersonationBanner: Locator

  constructor(page: Page) {
    this.page = page
    this.mainNav = page.getByRole('navigation', { name: /navigazione principale/i })
    this.logoutButton = page.getByRole('button', { name: /esci|logout/i })
    // Nessun data-testid noto sul banner di impersonificazione: fallback testuale.
    this.impersonationBanner = page.getByText(/stai impersonando|torna al tuo account/i)
  }

  async goto() {
    await this.page.goto('/dashboard')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/dashboard/)
  }

  navLink(name: string | RegExp): Locator {
    return this.mainNav.getByRole('link', { name })
  }

  async gotoViaMenu(name: string | RegExp) {
    await this.navLink(name).click()
  }
}
