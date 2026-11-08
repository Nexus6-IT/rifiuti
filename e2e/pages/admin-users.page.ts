import { type Page, type Locator, expect } from '@playwright/test'
import { eseguiAzioneRiga } from '../utils/azioni-riga'

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

  /**
   * «Impersona» sta nel menu ⋯ della riga (solo SUPER_ADMIN): `eseguiAzioneRiga` apre il menu e
   * sceglie la voce, o clicca il bottone se un domani tornasse sulla riga.
   */
  async impersona(row: Locator) {
    await eseguiAzioneRiga(this.page, row, 'Impersona')
  }
}
