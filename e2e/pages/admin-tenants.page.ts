import { type Page, type Locator, expect } from '@playwright/test'

/** Page Object per /admin/tenants (TenantAdminComponent). */
export class AdminTenantsPage {
  readonly page: Page
  readonly table: Locator

  constructor(page: Page) {
    this.page = page
    this.table = page.getByRole('table')
  }

  async goto() {
    await this.page.goto('/admin/tenants')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/admin\/tenants/)
  }

  rowByName(name: string | RegExp): Locator {
    return this.table.getByRole('row').filter({ hasText: name })
  }

  /**
   * Cambio status (sospendi/riattiva) è DISTRUTTIVO per un tenant intero
   * (blacklist — PATCH /admin/tenants/:id/status). Il guardrail lo blocca su
   * produzione.
   */
  statusButtonInRow(row: Locator): Locator {
    return row.getByRole('button', { name: /sospendi|riattiva/i })
  }
}
