import { type Page, type Locator, expect } from '@playwright/test'

export type RegistryEntity = 'produttori' | 'trasportatori' | 'destinatari'

/**
 * Page Object generico per le 3 liste di anagrafiche
 * (features/registry/{produttori,trasportatori,destinatari}-list.component.ts)
 * — stesso pattern CRUD via dialog condiviso `anagrafica-form-dialog.component.ts`.
 */
export class RegistryPage {
  readonly page: Page
  readonly entity: RegistryEntity
  readonly nuovoButton: Locator
  readonly table: Locator
  readonly searchInput: Locator

  constructor(page: Page, entity: RegistryEntity) {
    this.page = page
    this.entity = entity
    this.nuovoButton = page.getByRole('button', { name: /nuovo|aggiungi|crea/i })
    this.table = page.getByRole('table')
    this.searchInput = page.getByRole('textbox', { name: /cerca/i })
  }

  async goto() {
    await this.page.goto(`/${this.entity}`)
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(new RegExp(`/${this.entity}`))
  }

  rowByText(text: string | RegExp): Locator {
    return this.table.getByRole('row').filter({ hasText: text })
  }

  /**
   * Elimina una riga: azione DISTRUTTIVA per le 3 anagrafiche (blacklist).
   * Il guardrail la blocca comunque su produzione — usarla solo in ambienti
   * locali/staging con dati throwaway.
   */
  deleteButtonInRow(row: Locator): Locator {
    return row.getByRole('button', { name: /elimina/i })
  }
}
