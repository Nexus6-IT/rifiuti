import { type Page, type Locator, expect } from '@playwright/test'

/**
 * Page Object per le pagine dedicate delle tre anagrafiche di registro
 * (produttori-list.component.ts, trasportatori-list.component.ts,
 * destinatari-list.component.ts) — condiviso dai test di Task 3 (produttore)
 * e Task 4 (trasportatore/destinatario, vedi i metodi sulla scadenza aggiunti
 * lì) perché le tre pagine condividono ESATTAMENTE lo stesso schema di
 * `data-testid` e la stessa forma del dialog CRUD (ognuna con un dialog
 * INLINE proprio — non il dialog condiviso
 * `AnagraficaFormDialogComponent`, montato solo dentro `fir-list.component.ts`
 * per la creazione rapida di una controparte da "Nuovo FIR").
 *
 * Selettori: solo `data-testid` (aggiunti 2026-09-14 apposta per questo
 * piano), mai testo o classi CSS — vedi i template dei tre componenti.
 */
export type AreaAnagrafica = 'produttori' | 'trasportatori' | 'destinatari'

export class AnagrafichePage {
  readonly page: Page
  readonly area: AreaAnagrafica

  readonly nuovoButton: Locator
  readonly formDialog: Locator
  readonly saveButton: Locator
  readonly cancelButton: Locator
  readonly confirmDialog: Locator

  constructor(page: Page, area: AreaAnagrafica) {
    this.page = page
    this.area = area
    this.nuovoButton = page.getByTestId(`${area}-nuovo-button`)
    this.formDialog = page.getByTestId(`${area}-form-dialog`)
    this.saveButton = page.getByTestId(`${area}-form-save-button`)
    this.cancelButton = page.getByTestId(`${area}-form-cancel-button`)
    this.confirmDialog = page.getByTestId(`${area}-confirm-dialog`)
  }

  async goto() {
    await this.page.goto(`/${this.area}`)
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(new RegExp(`/${this.area}`))
    await expect(this.nuovoButton).toBeVisible()
  }

  /** Riga della tabella per l'id dell'anagrafica (assegnato dal backend). */
  row(id: string): Locator {
    return this.page.getByTestId(`${this.area}-row-${id}`)
  }

  editButton(id: string): Locator {
    return this.page.getByTestId(`${this.area}-modifica-${id}`)
  }

  deleteButton(id: string): Locator {
    return this.page.getByTestId(`${this.area}-elimina-${id}`)
  }

  /** Apre il dialog di creazione e attende che sia visibile. */
  async apriNuovo() {
    await this.nuovoButton.click()
    await expect(this.formDialog).toBeVisible()
  }

  /** Apre il dialog di modifica per l'id indicato e attende che sia visibile. */
  async apriModifica(id: string) {
    await this.editButton(id).click()
    await expect(this.formDialog).toBeVisible()
  }

  /** Clic su "Salva": il dialog resta responsabilità del chiamante da verificare (si chiude solo se il salvataggio va a buon fine). */
  async salva() {
    await this.saveButton.click()
  }

  async annulla() {
    await this.cancelButton.click()
    await expect(this.formDialog).toBeHidden()
  }

  /**
   * Elimina una riga: azione DISTRUTTIVA per le 3 anagrafiche (guardrail in
   * utils/blacklist.ts). Clicca l'icona elimina della riga, conferma nel
   * `p-confirmDialog` dedicato all'area, e attende che la riga sparisca.
   *
   * Il pulsante di conferma NON ha un `data-testid` proprio (solo il dialog
   * lo ha) — gap già documentato in `e2e/SELECTORS-DEBT.md` ("Anagrafiche —
   * Produttori, Trasportatori, Destinatari": il template di default di
   * PrimeNG `ConfirmationService` non espone i pulsanti interni, e i tre
   * componenti non passano `acceptLabel`, quindi resta la label di default
   * di PrimeNG senza traduzione italiana configurata — "Yes", non "Sì").
   * Il locator accetta entrambe le lingue per non dipendere da quale
   * traduzione risulti effettivamente montata.
   */
  async elimina(id: string) {
    await this.deleteButton(id).click()
    await expect(this.confirmDialog).toBeVisible()
    await this.confirmDialog.getByRole('button', { name: /^(s(ì|i)|yes)$/i }).click()
    await expect(this.row(id)).toBeHidden()
  }
}
