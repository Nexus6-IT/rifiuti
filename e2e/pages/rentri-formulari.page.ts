import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /rentri/formulari (RentriFormulariComponent —
 * features/rentri/rentri-formulari.component.ts, R2 Task 8).
 *
 * Tutti i selettori sono `data-testid` — v. e2e/SELECTORS-DEBT.md, sezione
 * "RENTRI — aggancio dei formulari (colmato in R2 Task 8)". Nessun testid
 * qui è inventato: ognuno è già presente in quella lista, verificata contro
 * il componente prima di scrivere questo file (v. task-9-brief.md).
 */
export class RentriFormulariPage {
  readonly page: Page

  readonly nonAutorizzato: Locator
  readonly searchInput: Locator
  readonly cercaButton: Locator
  readonly loading: Locator
  readonly errore: Locator
  readonly emptyState: Locator
  readonly table: Locator
  readonly sediLink: Locator

  readonly confirmDialog: Locator
  readonly confirmDialogModalitaNuovo: Locator
  readonly confirmDialogModalitaEsistente: Locator
  readonly confirmDialogFirLocaleSelect: Locator
  readonly confirmDialogFirLocaliTroncati: Locator
  readonly confirmDialogConfirmButton: Locator
  readonly confirmDialogCancelButton: Locator

  constructor(page: Page) {
    this.page = page

    this.nonAutorizzato = page.getByTestId('rentri-formulari-non-autorizzato')
    this.searchInput = page.getByTestId('rentri-formulari-search-input')
    this.cercaButton = page.getByTestId('rentri-formulari-cerca-button')
    this.loading = page.getByTestId('rentri-formulari-loading')
    this.errore = page.getByTestId('rentri-formulari-errore')
    this.emptyState = page.getByTestId('rentri-formulari-empty-state')
    this.table = page.getByTestId('rentri-formulari-table')
    this.sediLink = page.getByTestId('rentri-formulari-sedi-link')

    this.confirmDialog = page.getByTestId('rentri-formulari-confirm-dialog')
    this.confirmDialogModalitaNuovo = page.getByTestId(
      'rentri-formulari-confirm-dialog-modalita-nuovo'
    )
    this.confirmDialogModalitaEsistente = page.getByTestId(
      'rentri-formulari-confirm-dialog-modalita-esistente'
    )
    this.confirmDialogFirLocaleSelect = page.getByTestId(
      'rentri-formulari-confirm-dialog-fir-locale-select'
    )
    this.confirmDialogFirLocaliTroncati = page.getByTestId(
      'rentri-formulari-confirm-dialog-fir-locali-troncati'
    )
    this.confirmDialogConfirmButton = page.getByTestId(
      'rentri-formulari-confirm-dialog-confirm-button'
    )
    this.confirmDialogCancelButton = page.getByTestId(
      'rentri-formulari-confirm-dialog-cancel-button'
    )
  }

  async goto() {
    await this.page.goto('/rentri/formulari')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/rentri\/formulari/)
  }

  /** Riga tabella per numero FIR (data-testid dinamico, non testo). */
  row(numeroFir: string): Locator {
    return this.page.getByTestId(`rentri-formulari-row-${numeroFir}`)
  }

  statusBadge(numeroFir: string): Locator {
    return this.page.getByTestId(`rentri-formulari-status-${numeroFir}`)
  }

  agganciaButton(numeroFir: string): Locator {
    return this.page.getByTestId(`rentri-formulari-aggancia-${numeroFir}`)
  }

  async apriDialogAggancio(numeroFir: string) {
    await this.agganciaButton(numeroFir).click()
    await expect(this.confirmDialog).toBeVisible()
  }
}
