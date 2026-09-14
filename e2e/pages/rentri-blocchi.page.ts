import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /rentri/blocchi (RentriBlocchiComponent —
 * features/rentri/rentri-blocchi.component.ts, R6 Task 6).
 *
 * Tutti i selettori sono `data-testid` letti direttamente dal componente
 * (vedi task-6-brief.md): nessuno è inventato. I blocchi si creano
 * ESCLUSIVAMENTE sul portale dell'ente — questa pagina è di sola lettura
 * per i blocchi stessi, con due sole azioni reali (predefinito, vidima).
 */
export class RentriBlocchiPage {
  readonly page: Page

  readonly nonAutorizzato: Locator
  readonly loading: Locator
  readonly notaPortale: Locator
  readonly scortaSection: Locator
  readonly scortaTotale: Locator
  readonly emptyState: Locator
  readonly listAttivi: Locator
  readonly listDisattivati: Locator

  readonly vidimaDialog: Locator
  readonly vidimaInputQuantita: Locator
  readonly vidimaConferma: Locator

  constructor(page: Page) {
    this.page = page

    this.nonAutorizzato = page.getByTestId('rentri-blocchi-non-autorizzato')
    this.loading = page.getByTestId('rentri-blocchi-loading')
    this.notaPortale = page.getByTestId('rentri-blocchi-nota-portale')
    this.scortaSection = page.getByTestId('rentri-blocchi-scorta')
    this.scortaTotale = page.getByTestId('rentri-blocchi-scorta-totale')
    this.emptyState = page.getByTestId('rentri-blocchi-empty-state')
    this.listAttivi = page.getByTestId('rentri-blocchi-list-attivi')
    this.listDisattivati = page.getByTestId('rentri-blocchi-list-disattivati')

    this.vidimaDialog = page.getByTestId('rentri-blocchi-vidima-dialog')
    this.vidimaInputQuantita = page.getByTestId('rentri-blocchi-vidima-input-quantita')
    this.vidimaConferma = page.getByTestId('rentri-blocchi-vidima-conferma')
  }

  async goto() {
    await this.page.goto('/rentri/blocchi')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/rentri\/blocchi/)
  }

  /** Riga di un blocco, attivo o disattivato (stesso testid per entrambe le liste). */
  row(codiceBlocco: string): Locator {
    return this.page.getByTestId(`rentri-blocchi-row-${codiceBlocco}`)
  }

  vidimaButton(codiceBlocco: string): Locator {
    return this.page.getByTestId(`rentri-blocchi-vidima-${codiceBlocco}`)
  }

  setPredefinitoButton(codiceBlocco: string): Locator {
    return this.page.getByTestId(`rentri-blocchi-set-predefinito-${codiceBlocco}`)
  }

  /** Tutti i bottoni "Vidima un lotto" attualmente in pagina (uno per blocco attivo). */
  vidimaButtons(): Locator {
    return this.page.locator('[data-testid^="rentri-blocchi-vidima-"]')
  }

  async apriVidimazione(codiceBlocco: string) {
    await this.vidimaButton(codiceBlocco).click()
    await expect(this.vidimaDialog).toBeVisible()
  }
}
