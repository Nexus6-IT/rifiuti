import { type Page, type Locator, expect } from '@playwright/test'

/** Page Object per /registro (Registro carico/scarico, art. 190 D.Lgs 152/2006). */
export class RegistroPage {
  readonly page: Page
  readonly nuovoMovimentoButton: Locator
  readonly table: Locator

  constructor(page: Page) {
    this.page = page
    this.nuovoMovimentoButton = page.getByRole('button', { name: /nuovo movimento|nuovo/i })
    this.table = page.getByRole('table')
  }

  async goto() {
    await this.page.goto('/registro')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/registro/)
  }
}
