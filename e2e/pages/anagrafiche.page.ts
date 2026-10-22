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

/**
 * Sottoinsieme delle aree che hanno un campo di scadenza facoltativo (Task 4
 * dello scadenzario, 2026-09-12): iscrizione all'Albo Gestori per i
 * trasportatori, autorizzazione per i destinatari. I produttori non hanno
 * una scadenza — non è un'omissione, l'anagrafica non ne ha bisogno.
 */
export type AreaConScadenza = 'trasportatori' | 'destinatari'

const TESTID_SCADENZA: Record<AreaConScadenza, string> = {
  trasportatori: 'trasportatori-scadenza-iscrizione-input',
  destinatari: 'destinatari-scadenza-autorizzazione-input',
}

function isAreaConScadenza(area: AreaAnagrafica): area is AreaConScadenza {
  return area === 'trasportatori' || area === 'destinatari'
}

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
    // Il data-testid sta sul tag host <p-dialog>/<p-confirmDialog>, che non ha
    // dimensioni proprie: PrimeNG disegna la finestra in un elemento interno
    // a posizione fissa (role="dialog"/"alertdialog"), presente solo quando
    // e' aperta. Puntare all'host dava "hidden" anche a finestra aperta.
    this.formDialog = page
      .getByTestId(`${area}-form-dialog`)
      .locator('[role="dialog"], [role="alertdialog"]')
    this.saveButton = page.getByTestId(`${area}-form-save-button`)
    this.cancelButton = page.getByTestId(`${area}-form-cancel-button`)
    this.confirmDialog = page
      .getByTestId(`${area}-confirm-dialog`)
      .locator('[role="dialog"], [role="alertdialog"]')
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

  /** Apre il dialog di creazione e attende che sia pronto per la compilazione. */
  async apriNuovo() {
    await this.nuovoButton.click()
    await this.attendiDialogPronto()
  }

  /** Apre il dialog di modifica per l'id indicato e attende che sia pronto per la compilazione. */
  async apriModifica(id: string) {
    await this.editButton(id).click()
    await this.attendiDialogPronto()
  }

  /**
   * Visibile non basta: a fine animazione di apertura p-dialog porta il focus
   * sul primo campo (focusOnShow). Se si comincia a compilare prima, quel
   * cambio di focus arriva a meta' di un fill() e il testo finisce nel primo
   * campo invece che in quello voluto (visto il 22/10: il CAP accodato alla
   * ragione sociale). Si aspetta quindi che il focus sia gia' dentro il dialog.
   */
  private async attendiDialogPronto() {
    await expect(this.formDialog).toBeVisible()
    await expect(this.formDialog.locator('input:focus, textarea:focus, button:focus')).toHaveCount(
      1
    )
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

  /**
   * Input della scadenza (Task 4 dello scadenzario) — esiste solo per
   * `trasportatori` (scadenza iscrizione Albo) e `destinatari` (scadenza
   * autorizzazione). Lancia se chiamato per `produttori`, invece di
   * restituire un locator che non troverà mai nulla: un test che lo usasse
   * per errore su quell'area deve fallire in modo esplicito, non restare
   * silenziosamente pending su `toBeVisible()`.
   */
  get scadenzaInput(): Locator {
    if (!isAreaConScadenza(this.area)) {
      throw new Error(
        `AnagrafichePage.scadenzaInput non esiste per l'area "${this.area}": questa anagrafica non ha un campo di scadenza.`
      )
    }
    return this.page.getByTestId(TESTID_SCADENZA[this.area])
  }
}
