import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /admin/utenti (UserAdminComponent).
 * Copre anche il flusso di impersonificazione (UAT critico #4 dell'audit
 * frontend): avvio da questa pagina, banner globale su LayoutComponent,
 * "Torna al tuo account" per uscire.
 */
export class AdminUsersPage {
  readonly page: Page
  readonly table: Locator
  readonly nuovoUtenteButton: Locator

  constructor(page: Page) {
    this.page = page
    this.table = page.getByRole('table')
    this.nuovoUtenteButton = page.getByRole('button', { name: /nuovo utente|invita/i })
  }

  async goto() {
    await this.page.goto('/admin/utenti')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/admin\/utenti/)
  }

  rowByEmail(email: string): Locator {
    return this.table.getByRole('row').filter({ hasText: email })
  }

  impersonaButtonInRow(row: Locator): Locator {
    return row.getByRole('button', { name: /impersona/i })
  }
}
