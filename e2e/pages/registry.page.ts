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
    // NON `getByRole('button', {name: /nuovo|aggiungi|crea/i})`: sulle tre
    // liste (produttori/trasportatori/destinatari-list.component.ts) esiste
    // ANCHE un bottone "Nuovo …" nello stato vuoto della tabella
    // (`pTemplate="emptymessage"`), con `ariaLabel="Crea nuovo …"` — che la
    // regex matcha comunque via "crea". Con entrambi i bottoni nel DOM
    // (intestazione + stato vuoto, che PrimeNG monta anche a `display:none`)
    // il locator per ruolo risolve a 2 elementi e viola la modalità
    // stretta. Il bottone d'intestazione ha invece un `data-testid`
    // univoco per area (`{entity}-nuovo-button`, aggiunto apposta — v.
    // `e2e/SELECTORS-DEBT.md`), quello nello stato vuoto no: usarlo evita
    // l'ambiguità alla radice invece di provare a restringere la regex.
    this.nuovoButton = page.getByTestId(`${entity}-nuovo-button`)
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
