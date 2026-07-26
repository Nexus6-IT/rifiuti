import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per /fir (FirListComponent — features/fir/fir-list.component.ts).
 *
 * Le azioni di ciclo di vita (emetti/presa in carico/conferma consegna/annulla)
 * non hanno `data-testid` (gap di testabilità documentato in
 * e2e/SELECTORS-DEBT.md) e usano ancora testo bottoni PrimeNG/ARIA. Le azioni
 * RENTRI (R1) hanno invece `data-testid` stabili — v. metodi
 * `rentriBadge`/`rentriTrasmetti`/`rentriRiprova`/`rentriConfermaLegame` sotto.
 */
export class FirListPage {
  readonly page: Page
  readonly nuovoFirButton: Locator
  readonly table: Locator

  constructor(page: Page) {
    this.page = page
    this.nuovoFirButton = page.getByRole('button', { name: /nuovo fir/i })
    this.table = page.getByRole('table')
  }

  async goto() {
    await this.page.goto('/fir')
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/fir/)
  }

  /** Riga tabella per numero FIR (testo visibile, non un id stabile). */
  rowByText(text: string | RegExp): Locator {
    return this.table.getByRole('row').filter({ hasText: text })
  }

  actionButtonInRow(row: Locator, action: string | RegExp): Locator {
    return row.getByRole('button', { name: action })
  }

  async openNuovoFirDialog() {
    await this.nuovoFirButton.click()
  }

  // Azioni di ciclo vita — bottoni per riga, testo osservato nell'audit.
  async emetti(row: Locator) {
    await this.actionButtonInRow(row, /emetti/i).click()
  }

  async presaInCarico(row: Locator) {
    await this.actionButtonInRow(row, /presa.{0,2}in.{0,2}carico/i).click()
  }

  async confermaConsegna(row: Locator) {
    await this.actionButtonInRow(row, /conferma consegna/i).click()
  }

  /**
   * `annulla` è un'azione DISTRUTTIVA (blacklist, vedi utils/blacklist.ts):
   * mai invocarla in test che possono girare contro produzione. Il guardrail
   * la blocca comunque a runtime se il baseURL è di produzione.
   */
  async annulla(row: Locator) {
    await this.actionButtonInRow(row, /annulla/i).click()
  }

  // --- RENTRI (R1 Task 6) — data-testid stabili, v. fir-list.component.ts riga ~174-272 ---

  /** Badge di stato sincronizzazione RENTRI per riga, `numeroFir` = numeroProgressivo (o id se assente). */
  rentriBadge(numeroFir: string): Locator {
    return this.page.locator(`[data-testid="rentri-sync-badge-${numeroFir}"]`)
  }

  rentriTrasmettiButton(numeroFir: string): Locator {
    return this.page.locator(`[data-testid="fir-rentri-trasmetti-${numeroFir}"]`)
  }

  rentriRiprovaButton(numeroFir: string): Locator {
    return this.page.locator(`[data-testid="fir-rentri-riprova-${numeroFir}"]`)
  }

  rentriConfermaLegameButton(numeroFir: string): Locator {
    return this.page.locator(`[data-testid="fir-rentri-conferma-legame-${numeroFir}"]`)
  }
}
