import { type Page, type Locator, expect } from '@playwright/test'

/** Page Object per /permissions/denied (PermissionDeniedComponent, buona copertura testid). */
export class PermissionDeniedPage {
  readonly page: Page
  readonly goBackButton: Locator
  readonly requestAccessButton: Locator

  constructor(page: Page) {
    this.page = page
    this.goBackButton = page.getByTestId('go-back-button')
    this.requestAccessButton = page.getByTestId('request-access-button')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/permissions\/denied/)
  }
}
