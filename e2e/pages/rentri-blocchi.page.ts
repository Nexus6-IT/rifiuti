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
    // `data-testid="rentri-blocchi-vidima-input-quantita"` è un attributo
    // statico sul tag host `<p-inputNumber>` nel componente, non
    // sull'`<input>` nativo che PrimeNG genera al suo interno (quello ha
    // `inputId="vidima-quantita"`, dichiarato nel template). Playwright
    // rifiuta `.fill()` su un elemento che non è input/textarea/
    // contenteditable, quindi il locator deve puntare all'input interno —
    // stessa classe di difetto già trovata su `vidimaButtons()` (v. sopra),
    // qui annidata due righe più in là e non cercata alla prima correzione.
    this.vidimaInputQuantita = page
      .getByTestId('rentri-blocchi-vidima-input-quantita')
      .locator('input')
    // Stesso principio per il bottone: `data-testid` è sull'host `<p-button>`,
    // PrimeNG propaga `disabled` solo al `<button>` nativo interno.
    // `toBeDisabled()` su un host non nativo non fallisce mai (Playwright
    // ignora l'attributo su elementi non-form), quindi l'asserzione va fatta
    // sul `<button>` reale.
    this.vidimaConferma = page.getByTestId('rentri-blocchi-vidima-conferma').locator('button')
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

  /**
   * Tutti i bottoni "Vidima un lotto" attualmente in pagina (uno per blocco
   * attivo).
   *
   * ATTENZIONE alla collisione di prefisso: il componente usa lo stesso
   * prefisso `rentri-blocchi-vidima-` sia per questi bottoni
   * (`rentri-blocchi-vidima-{codiceBlocco}`) sia per il dialog e i suoi
   * controlli (`rentri-blocchi-vidima-dialog`, `-input-quantita`,
   * `-conferma`). Il `data-testid` del dialog è un attributo statico
   * sull'elemento host `p-dialog`: resta nel DOM anche a dialog chiuso
   * (`*ngIf` nasconde solo il contenuto interno, non l'host — verificato sul
   * sorgente PrimeNG). Un selettore `[data-testid^="rentri-blocchi-vidima-"]`
   * sull'intera pagina troverebbe quindi SEMPRE almeno l'host del dialog,
   * anche con zero blocchi attivi — il caso esatto in cui il chiamante deve
   * poter contare 0 e saltare. Per questo la ricerca è ristretta al
   * contenitore delle righe attive (`listAttivi`), che non contiene il
   * dialog (dichiarato come elemento a sé nel template, fuori da quella
   * sezione).
   */
  vidimaButtons(): Locator {
    return this.listAttivi.locator('[data-testid^="rentri-blocchi-vidima-"]')
  }

  async apriVidimazione(codiceBlocco: string) {
    await this.vidimaButton(codiceBlocco).click()
    await expect(this.vidimaDialog).toBeVisible()
  }
}
