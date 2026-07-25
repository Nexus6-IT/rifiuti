import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /permissions/my-permissions (PermissionDiscoveryComponent).
 * Ottima copertura data-testid (unico caso "buono" nell'audit §4) — usiamo
 * direttamente i testid invece di ARIA/testo.
 */
export class PermissionDiscoveryPage {
  readonly page: Page
  readonly roleBadge: Locator
  readonly permissionGrid: Locator
  readonly helpIcon: Locator

  constructor(page: Page) {
    this.page = page
    this.roleBadge = page.getByTestId('role-badge')
    this.permissionGrid = page.getByTestId('permission-grid')
    this.helpIcon = page.getByTestId('help-icon')
  }

  async goto() {
    await this.page.goto('/permissions/my-permissions')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/permissions\/my-permissions/)
  }

  categoryHeader(key: string): Locator {
    return this.page.getByTestId(`category-header-${key}`).or(this.page.getByTestId('category-header'))
  }

  categoryContent(key: string): Locator {
    return this.page.getByTestId(`category-content-${key}`)
  }

  permissionItem(raw: string): Locator {
    return this.page.getByTestId(`permission-item-${raw}`)
  }
}
